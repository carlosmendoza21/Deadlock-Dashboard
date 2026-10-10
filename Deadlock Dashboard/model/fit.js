const data = require('./data/train.json');
const CK = [360,720,900,1200,1500,1800,2100,2400,2700,3000];
const sig = z => 1 / (1 + Math.exp(-z));
const logit = p => Math.log(p / (1 - p));
// badge = tier*10 + subrank  ->  linear skill in subrank units
const skill = b => Math.floor(b / 10) * 6 + (b % 10);
const GROUPS = { t1: /^Tier1/, t2: /^Tier2/, bar: /^BarrackBoss/, shr: /^TitanShield/ };

// deterministic split by match_id
const train = data.filter(m => m.match_id % 10 < 7), test = data.filter(m => m.match_id % 10 >= 7);

// hero winrates from train split, smoothed
const hw = {};
for (const m of train) for (const [hs, won] of [[m.h0, m.t0win], [m.h1, !m.t0win]]) for (const h of hs) {
  hw[h] ??= { w: 0, n: 0 }; hw[h].n++; if (won) hw[h].w++;
}
const heroLogit = h => { const s = hw[h] || { w: 0, n: 0 }; return logit((s.w + 50) / (s.n + 100)); };
const heroDiff = m => m.h0.reduce((a, h) => a + heroLogit(h), 0) - m.h1.reduce((a, h) => a + heroLogit(h), 0);
const RH = new Map(require('./data/ranks_hist.json').map(x => [x.match_id, x]));
const avgSkill = a => a.reduce((s, b) => s + skill(b), 0) / a.length;
const badgeDiff = m => { const r = RH.get(m.match_id); return (m.mm === 'Ranked' && r && r.r0.length >= 4 && r.r1.length >= 4) ? avgSkill(r.r0) - avgSkill(r.r1) : 0; };

// logistic regression via Newton's method (small dims)
function fitLR(X, y, l2 = 1e-3) {
  const d = X[0].length; let w = new Array(d).fill(0);
  for (let it = 0; it < 30; it++) {
    const g = new Array(d).fill(0), H = Array.from({ length: d }, () => new Array(d).fill(0));
    for (let i = 0; i < X.length; i++) {
      const p = sig(X[i].reduce((a, x, j) => a + x * w[j], 0)), r = p - y[i], s = p * (1 - p);
      for (let j = 0; j < d; j++) { g[j] += X[i][j] * r; for (let k = 0; k < d; k++) H[j][k] += X[i][j] * X[i][k] * s; }
    }
    for (let j = 0; j < d; j++) { g[j] += l2 * w[j] * X.length; H[j][j] += l2 * X.length; }
    // solve H * delta = g (gaussian elimination)
    const A = H.map((row, i) => [...row, g[i]]);
    for (let c = 0; c < d; c++) { let p = c; for (let r = c + 1; r < d; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r; [A[c], A[p]] = [A[p], A[c]];
      for (let r = 0; r < d; r++) if (r !== c) { const f = A[r][c] / A[c][c]; for (let k = c; k <= d; k++) A[r][k] -= f * A[c][k]; } }
    const delta = A.map((row, i) => row[d] / row[i]);
    w = w.map((x, j) => x - delta[j]);
    if (Math.max(...delta.map(Math.abs)) < 1e-7) break;
  }
  return w;
}
function evaluate(X, y, w) {
  let ll = 0, acc = 0; const bins = Array.from({ length: 5 }, () => ({ p: 0, y: 0, n: 0 }));
  X.forEach((x, i) => { const p = sig(x.reduce((a, v, j) => a + v * w[j], 0));
    ll += y[i] ? -Math.log(p) : -Math.log(1 - p); acc += (p > .5) === !!y[i];
    const b = bins[Math.min(4, Math.floor(p * 5))]; b.p += p; b.y += y[i]; b.n++; });
  return { n: X.length, acc: +(acc / X.length).toFixed(3), logloss: +(ll / X.length).toFixed(3),
    calib: bins.filter(b => b.n).map(b => `${(b.p / b.n * 100).toFixed(0)}→${(b.y / b.n * 100).toFixed(0)}%`).join(' ') };
}

// ---- pregame: [badgeDiff, heroDiff]
const pre = ms => ({ X: ms.map(m => [badgeDiff(m), heroDiff(m)]), y: ms.map(m => +m.t0win) });
const pr = pre(train), pt = pre(test);
const wPre = fitLR(pr.X, pr.y);
console.log('PREGAME w=', wPre.map(v => v.toFixed(4)), evaluate(pt.X, pt.y, wPre));
const rk = test.filter(m => badgeDiff(m) !== 0), prk = pre(rk);
console.log('  ranked-only test', evaluate(prk.X, prk.y, wPre));

// ---- live per checkpoint: [preLogit, nwRel, nwAbs(10k), t1, t2, bar, shr] (objective diffs = enemy objectives destroyed - own lost)
function liveFeats(m, ci) {
  const t = CK[ci]; if (m.dur <= t || !m.nw0[ci] || !m.nw1[ci]) return null;
  const n0 = m.nw0[ci], n1 = m.nw1[ci];
  const lost = { 0: { t1: 0, t2: 0, bar: 0, shr: 0 }, 1: { t1: 0, t2: 0, bar: 0, shr: 0 } };
  m.oo.forEach((o, i) => { const dt = m.od[i]; if (!dt || dt > t) return;
    for (const [k, re] of Object.entries(GROUPS)) if (re.test(o)) lost[m.ot[i] === 'Team0' ? 0 : 1][k]++; });
  const preL = wPre[0] * badgeDiff(m) + wPre[1] * heroDiff(m);
  return [preL, (n0 - n1) / ((n0 + n1) / 2), (n0 - n1) / 10000,
    lost[1].t1 - lost[0].t1, lost[1].t2 - lost[0].t2, lost[1].bar - lost[0].bar, lost[1].shr - lost[0].shr];
}
const live = [];
for (let ci = 0; ci < CK.length; ci++) {
  const mk = ms => { const X = [], y = []; for (const m of ms) { const f = liveFeats(m, ci); if (f) { X.push(f); y.push(+m.t0win); } } return { X, y }; };
  const a = mk(train), b = mk(test);
  if (a.X.length < 300) break;
  const w = fitLR(a.X, a.y);
  live.push({ t: CK[ci], w: w.map(v => +v.toFixed(4)) });
  console.log(`t=${CK[ci] / 60}m w=[${w.map(v => v.toFixed(3)).join(', ')}]`, evaluate(b.X, b.y, w));
}
const heroWr = Object.fromEntries(Object.entries(hw).map(([h, s]) => [h, +((s.w + 50) / (s.n + 100)).toFixed(4)]));
require('fs').writeFileSync(require('path').join(__dirname, '../src/model/model.json'), JSON.stringify({ fittedOn: data.length, pregame: { badge: +wPre[0].toFixed(4), hero: +wPre[1].toFixed(4) }, live, heroWrFallback: heroWr }, null, 1));
