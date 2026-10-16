// Live backtest: scores the app's win probabilities against real match results.
//
//   npm run backtest           collect predictions for live matches (Ctrl+C to stop; prints a report every 30 min)
//   npm run backtest:report    look up any pending results, then print the report
//
// Predictions are made with the exact code the app uses (src/predictMatch.ts) on the same live data, so this
// measures what users see, including Watch-tab lag and live hero/rank lookups. Data is appended to backtest/*.jsonl,
// so collection can be stopped and restarted at any time.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { api, type AccountRank, type ActiveMatch, MATCH_MODE } from '../src/api';
import { elapsedOf, heroWinRatesFor, isNormal, isRanked, predictMatch, type PredictionInputs } from '../src/predictMatch';

const DIR = process.env.BACKTEST_DIR ?? join(import.meta.dirname, '..', 'backtest');
const SAMPLES = join(DIR, 'samples.jsonl');
const OUTCOMES = join(DIR, 'outcomes.jsonl');

const POLL_S = 60;
const RESOLVE_EVERY_S = 5 * 60;
const REPORT_EVERY_S = 30 * 60;
const ENDED_AFTER_S = 3 * 60;          // not seen live for this long -> treat as finished
const GIVE_UP_AFTER_S = 48 * 3600;     // results not available after this long -> unavailable

interface Sample {
  match_id: number;
  at: number;          // unix seconds when the prediction was made
  elapsed: number;     // game time the app showed, seconds
  ranked: boolean;
  p0: number;          // P(Team 0 wins), as shown in the app
  pre0: number;        // pre-game estimate (same inputs, game time 0) - shows what the live data adds
  nw0: number;
  nw1: number;
  ranks_known: boolean;
}

interface Outcome {
  match_id: number;
  status: 'resolved' | 'not_scored' | 'unavailable';
  winner: 0 | 1 | null;
  at: number;
}

const now = () => Date.now() / 1000;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const readJsonl = <T>(file: string): T[] =>
  existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l) as T) : [];
const append = (file: string, row: object) => appendFileSync(file, JSON.stringify(row) + '\n');

// ---------------------------------------------------------------------------------------------------------------
// State (rebuilt from disk on start)

mkdirSync(DIR, { recursive: true });
const lastSeen = new Map<number, number>();
const lastSouls = new Map<number, number>();
const outcomes = new Map<number, Outcome>();
const inputs = new Map<number, PredictionInputs>();

for (const s of readJsonl<Sample>(SAMPLES)) {
  lastSeen.set(s.match_id, Math.max(lastSeen.get(s.match_id) ?? 0, s.at));
  lastSouls.set(s.match_id, s.nw0 + s.nw1);
}
for (const o of readJsonl<Outcome>(OUTCOMES)) outcomes.set(o.match_id, o);

// ---------------------------------------------------------------------------------------------------------------
// Collect

const tracked = (m: ActiveMatch) =>
  isNormal(m) && (m.match_mode === MATCH_MODE.Ranked || m.match_mode === MATCH_MODE.Unranked);

/** Fetches ranks for all new matches in one batched call (the rank endpoint allows only 20 calls/min). */
async function loadInputs(newMatches: ActiveMatch[]) {
  for (let i = 0; i < newMatches.length; i += 80) {
    const chunk = newMatches.slice(i, i + 80); // 80 matches x 12 players stays under the 1000-id limit
    let ranks: AccountRank[];
    try {
      ranks = await api.ranksOf(chunk.flatMap(m => m.players.map(p => p.account_id)));
    } catch (e) {
      console.warn(`  rank lookup failed, will retry next poll: ${(e as Error).message}`);
      return;
    }
    const byId = new Map(ranks.map(r => [r.account_id, r]));
    for (const m of chunk) {
      const own = m.players.map(p => byId.get(p.account_id)).filter((r): r is AccountRank => !!r);
      inputs.set(m.match_id, {
        ranks: new Map(own.map(r => [r.account_id, r])),
        heroWinRates: await heroWinRatesFor(own),
      });
    }
  }
}

async function collect() {
  const live = (await api.activeMatches()).filter(tracked);
  const t = now();
  await loadInputs(live.filter(m => !inputs.has(m.match_id) && !outcomes.has(m.match_id)));

  let recorded = 0;
  for (const m of live) {
    const inp = inputs.get(m.match_id);
    if (!inp) continue;
    lastSeen.set(m.match_id, t);
    const souls = m.net_worth_team_0 + m.net_worth_team_1;
    if (lastSouls.get(m.match_id) === souls) continue; // only record new snapshots
    const p = predictMatch(m, t, inp);
    const pre = predictMatch(m, t, inp, 0);
    if (!p || !pre) continue;
    lastSouls.set(m.match_id, souls);
    append(SAMPLES, {
      match_id: m.match_id, at: Math.round(t), elapsed: Math.round(elapsedOf(m, t)), ranked: isRanked(m),
      p0: +p.pTeam0.toFixed(4), pre0: +pre.pTeam0.toFixed(4), nw0: m.net_worth_team_0, nw1: m.net_worth_team_1,
      ranks_known: inp.ranks.size > 0,
    } satisfies Sample);
    recorded++;
  }
  return { live: live.length, recorded };
}

// ---------------------------------------------------------------------------------------------------------------
// Resolve

async function resolve() {
  const t = now();
  const pending = [...lastSeen.entries()]
    .filter(([id, seen]) => !outcomes.has(id) && t - seen > ENDED_AFTER_S)
    .map(([id]) => id);

  let resolved = 0;
  for (let i = 0; i < pending.length; i += 100) {
    const chunk = pending.slice(i, i + 100);
    let results;
    try {
      results = await api.matchResults(chunk);
    } catch (e) {
      console.warn(`  result lookup failed, will retry: ${(e as Error).message}`);
      break;
    }
    const byId = new Map(results.map(r => [r.match_id, r]));
    for (const id of chunk) {
      const r = byId.get(id);
      let o: Outcome | undefined;
      if (r && (r.not_scored || r.match_outcome !== 'TeamWin')) o = { match_id: id, status: 'not_scored', winner: null, at: Math.round(t) };
      else if (r) o = { match_id: id, status: 'resolved', winner: r.winning_team === 'Team0' ? 0 : 1, at: Math.round(t) };
      else if (t - lastSeen.get(id)! > GIVE_UP_AFTER_S) o = { match_id: id, status: 'unavailable', winner: null, at: Math.round(t) };
      if (o) {
        outcomes.set(id, o);
        append(OUTCOMES, o);
        inputs.delete(id);
        if (o.status === 'resolved') resolved++;
      }
    }
    await sleep(2500); // the metadata endpoint allows 30 calls/min
  }
  return { checked: pending.length, resolved };
}

// ---------------------------------------------------------------------------------------------------------------
// Report

const BUCKETS = [
  { label: '0-5 min', from: 0, to: 5 }, { label: '5-10 min', from: 5, to: 10 }, { label: '10-15 min', from: 10, to: 15 },
  { label: '15-20 min', from: 15, to: 20 }, { label: '20-30 min', from: 20, to: 30 }, { label: '30-40 min', from: 30, to: 40 },
  { label: '40+ min', from: 40, to: Infinity },
];

interface Scored { p: number; pre: number; won: 0 | 1; soulsLead: number; ranked: boolean }

function metrics(rows: Scored[]) {
  const n = rows.length;
  const acc = rows.reduce((a, r) => a + (r.p === 0.5 ? 0.5 : +((r.p > 0.5) === (r.won === 1))), 0) / n;
  const brier = rows.reduce((a, r) => a + (r.p - r.won) ** 2, 0) / n;
  const brierPre = rows.reduce((a, r) => a + (r.pre - r.won) ** 2, 0) / n;
  const clamp = (p: number) => Math.min(1 - 1e-6, Math.max(1e-6, p));
  const logloss = rows.reduce((a, r) => a - Math.log(clamp(r.won ? r.p : 1 - r.p)), 0) / n;
  const souls = rows.reduce((a, r) => a + (r.soulsLead === 0 ? 0.5 : +((r.soulsLead > 0) === (r.won === 1))), 0) / n;
  const ci = 1.96 * Math.sqrt((acc * (1 - acc)) / n);
  return { n, acc, ci, brier, brierPre, logloss, souls };
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

function table(headers: string[], rows: (string | number)[][]) {
  const cells = [headers, ...rows.map(r => r.map(String))];
  const widths = headers.map((_, i) => Math.max(...cells.map(r => r[i].length)));
  const line = (r: string[]) => r.map((c, i) => (i === 0 ? c.padEnd(widths[i]) : c.padStart(widths[i]))).join('   ');
  console.log('  ' + line(cells[0]));
  console.log('  ' + widths.map(w => '-'.repeat(w)).join('   '));
  for (const r of cells.slice(1)) console.log('  ' + line(r));
}

function report() {
  const samples = readJsonl<Sample>(SAMPLES);
  const all = new Map<number, Sample[]>();
  for (const s of samples) all.set(s.match_id, [...(all.get(s.match_id) ?? []), s]);

  const statuses = [...all.keys()].map(id => outcomes.get(id)?.status ?? 'pending');
  const count = (s: string) => statuses.filter(x => x === s).length;
  console.log(`\n=== Live backtest report (${new Date().toLocaleString()}) ===`);
  console.log(`Matches tracked: ${all.size}   resolved: ${count('resolved')}   waiting for results: ${count('pending')}` +
    `   not scored: ${count('not_scored')}   results never published: ${count('unavailable')}`);

  // One sample per match per time bucket (the first one), so long matches with many polls don't dominate.
  const byBucket = BUCKETS.map(() => [] as Scored[]);
  for (const [id, ss] of all) {
    const o = outcomes.get(id);
    if (o?.status !== 'resolved') continue;
    const won = (o.winner === 0 ? 1 : 0) as 0 | 1; // from Team 0's point of view
    BUCKETS.forEach((b, i) => {
      const s = ss.find(x => x.elapsed / 60 >= b.from && x.elapsed / 60 < b.to);
      if (s) byBucket[i].push({ p: s.p0, pre: s.pre0, won, soulsLead: s.nw0 - s.nw1, ranked: s.ranked });
    });
  }
  const scored = byBucket.flat();
  if (!scored.length) {
    console.log('\nNo resolved matches yet. Results usually appear 1-3 hours after a match ends; run this again later.\n');
    return;
  }

  console.log('\nBy game time (Brier: lower is better, a coin flip scores 0.250):');
  table(
    ['Game time', 'Matches', 'Accuracy', '95% CI', 'Brier', 'Brier pre-game only', 'Log loss', 'Souls leader wins'],
    BUCKETS.flatMap((b, i) => {
      if (!byBucket[i].length) return [];
      const m = metrics(byBucket[i]);
      return [[b.label, m.n, pct(m.acc), `±${pct(m.ci)}`, m.brier.toFixed(3), m.brierPre.toFixed(3), m.logloss.toFixed(3), pct(m.souls)]];
    }),
  );

  console.log('\nBy mode (all game times):');
  table(
    ['Mode', 'Samples', 'Accuracy', 'Brier'],
    ([['Ranked', true], ['Standard', false]] as const).flatMap(([label, ranked]) => {
      const rows = scored.filter(r => r.ranked === ranked);
      if (!rows.length) return [];
      const m = metrics(rows);
      return [[label, m.n, pct(m.acc), m.brier.toFixed(3)]];
    }),
  );

  console.log('\nCalibration: when the favourite is given X%, how often do they win? (all game times)');
  const bins = [0.5, 0.6, 0.7, 0.8, 0.9].map(lo => ({ lo, hi: lo + 0.1, ps: [] as number[], wins: 0 }));
  for (const r of scored) {
    const fav = Math.max(r.p, 1 - r.p), favWon = r.p >= 0.5 ? r.won : 1 - r.won;
    const bin = bins.find(b => fav >= b.lo && fav < b.hi) ?? bins[bins.length - 1];
    bin.ps.push(fav);
    bin.wins += favWon;
  }
  table(
    ['Predicted', 'Samples', 'Avg predicted', 'Actually won', 'Gap'],
    bins.filter(b => b.ps.length).map(b => {
      const pred = b.ps.reduce((a, x) => a + x, 0) / b.ps.length, act = b.wins / b.ps.length;
      return [`${b.lo * 100}-${Math.round(b.hi * 100)}%`, b.ps.length, pct(pred), pct(act), `${act >= pred ? '+' : ''}${((act - pred) * 100).toFixed(1)} pts`];
    }),
  );
  console.log('\nSmall samples are noisy: treat buckets with fewer than ~200 matches as indicative only.\n');
}

// ---------------------------------------------------------------------------------------------------------------

async function main() {
  const mode = process.argv[2] ?? 'collect';
  if (mode === 'report') {
    const r = await resolve();
    if (r.checked) console.log(`Checked ${r.checked} finished matches for results, ${r.resolved} newly resolved.`);
    report();
    return;
  }
  if (mode !== 'collect') throw new Error(`Unknown mode "${mode}". Use "collect" or "report".`);

  console.log(`Collecting predictions every ${POLL_S}s into ${DIR}. Press Ctrl+C to stop.`);
  process.on('SIGINT', () => { report(); process.exit(0); });

  let lastResolve = 0, lastReport = now();
  for (;;) {
    const started = now();
    try {
      const c = await collect();
      let line = `[${new Date().toLocaleTimeString()}] ${c.live} live matches, ${c.recorded} new predictions`;
      if (now() - lastResolve > RESOLVE_EVERY_S) {
        const r = await resolve();
        lastResolve = now();
        line += `, ${r.resolved} results found (${r.checked - r.resolved} still waiting)`;
      }
      console.log(line);
      if (now() - lastReport > REPORT_EVERY_S) { report(); lastReport = now(); }
    } catch (e) {
      console.warn(`[${new Date().toLocaleTimeString()}] poll failed: ${(e as Error).message}`);
    }
    await sleep(Math.max(1000, (POLL_S - (now() - started)) * 1000));
  }
}

main().catch(e => { console.error(e); process.exit(1); });
