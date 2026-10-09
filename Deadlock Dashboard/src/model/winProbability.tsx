// Win probability for a live Deadlock match (Normal 6v6 mode).
//
// Coefficients in model.json are fitted by model/fit.cjs: logistic regressions on ~25k
// recent ranked + unranked matches, one per game-time checkpoint. Features are all
// expressed from Team 0's point of view:
//   pregame  = badge * avgRankDiff + hero * heroStrengthDiff
//   live(t)  = w0*pregame + w1*relNetWorthDiff + w2*netWorthDiff/10k
//            + w3..w6 * (enemy objectives destroyed - own objectives lost) for
//              guardians, walkers, base guardians, shrines
// Between checkpoints the weights are linearly interpolated.
import model from './model.json';

const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));
const logit = (p: number) => Math.log(p / (1 - p));

/** badge = tier*10 + subrank, with 6 subranks per tier -> linear subrank units. */
export const badgeToSkill = (badge: number) => Math.floor(badge / 10) * 6 + (badge % 10);

/** Objective bit positions (a set bit means the objective is still standing). */
export const OBJECTIVES = {
  core: [0],
  t1: [1, 3, 4],     // Guardians (lanes 1, 3, 4)
  t2: [5, 7, 8],     // Walkers
  titan: [9],        // Patron
  shr: [10, 11],     // Shrines (Patron shield generators)
  bar: [12, 14, 15], // Base Guardians
} as const;
export const LANES = [
  { lane: 1, name: 'Yellow', t1: 1, t2: 5, bar: 12 },
  { lane: 3, name: 'Blue', t1: 3, t2: 7, bar: 14 },
  { lane: 4, name: 'Purple', t1: 4, t2: 8, bar: 15 },
] as const;

export const isStanding = (mask: number, bit: number) => ((mask >> bit) & 1) === 1;
const lostCount = (mask: number, bits: readonly number[]) => bits.filter(b => !isStanding(mask, b)).length;

export function objectivesLost(mask: number) {
  return {
    t1: lostCount(mask, OBJECTIVES.t1),
    t2: lostCount(mask, OBJECTIVES.t2),
    bar: lostCount(mask, OBJECTIVES.bar),
    shr: lostCount(mask, OBJECTIVES.shr),
  };
}

/** Smoothed hero win rate, the same prior the model was fitted with. */
export const smoothedWinRate = (wins: number, matches: number) => (wins + 50) / (matches + 100);

export function heroStrength(heroIds: number[], winRates: Map<number, number>) {
  const fallback = model.heroWrFallback as Record<string, number>;
  return heroIds.reduce((sum, h) => sum + logit(winRates.get(h) ?? fallback[h] ?? 0.5), 0);
}

export interface MatchState {
  elapsedS: number;
  netWorth: [number, number];
  objectivesMask: [number, number];
  /** Team-average skill in subrank units (badgeToSkill), or null if ranks are unknown. */
  avgSkill: [number | null, number | null];
  heroStrength: [number, number];
  /** Only ranked matches were used to fit the rank coefficient. */
  ranked: boolean;
}

export interface Factor {
  key: 'rank' | 'heroes' | 'networth' | 'objectives';
  label: string;
  /** Contribution to Team 0's log-odds. Positive favours Team 0. */
  logOdds: number;
  detail: string;
}

export interface Prediction {
  /** Probability that Team 0 (Amber Hand) wins. */
  pTeam0: number;
  factors: Factor[];
  /** Weight the live state carries vs. the pre-game estimate, 0..1, for display. */
  liveShare: number;
}

type W = [number, number, number, number, number, number, number];

function weightsAt(t: number): W {
  const live = model.live as { t: number; w: number[] }[];
  const pre: W = [1, 0, 0, 0, 0, 0, 0];
  if (t <= 0) return pre;
  if (t < live[0].t) return lerp(pre, live[0].w as W, t / live[0].t);
  for (let i = 1; i < live.length; i++) {
    if (t <= live[i].t) {
      const a = live[i - 1], b = live[i];
      return lerp(a.w as W, b.w as W, (t - a.t) / (b.t - a.t));
    }
  }
  return live[live.length - 1].w as W;
}
const lerp = (a: W, b: W, f: number) => a.map((x, i) => x + (b[i] - x) * f) as W;

export function predict(s: MatchState): Prediction {
  const w = weightsAt(s.elapsedS);

  const skillDiff = s.ranked && s.avgSkill[0] != null && s.avgSkill[1] != null ? s.avgSkill[0] - s.avgSkill[1] : 0;
  const rankL = model.pregame.badge * skillDiff;
  const heroL = model.pregame.hero * (s.heroStrength[0] - s.heroStrength[1]);

  const [n0, n1] = s.netWorth;
  const nwRel = n0 + n1 > 0 ? (n0 - n1) / ((n0 + n1) / 2) : 0;
  const nwL = w[1] * nwRel + w[2] * ((n0 - n1) / 10_000);

  const l0 = objectivesLost(s.objectivesMask[0]);
  const l1 = objectivesLost(s.objectivesMask[1]);
  const objL = w[3] * (l1.t1 - l0.t1) + w[4] * (l1.t2 - l0.t2) + w[5] * (l1.bar - l0.bar) + w[6] * (l1.shr - l0.shr);

  const factors: Factor[] = [
    {
      key: 'rank', label: 'Rank gap', logOdds: w[0] * rankL,
      detail: !s.ranked ? 'Not used in unranked matches'
        : skillDiff === 0 && (s.avgSkill[0] == null || s.avgSkill[1] == null) ? 'Ranks unavailable'
        : `${Math.abs(skillDiff).toFixed(1)} subranks ${skillDiff >= 0 ? 'in favour of Amber' : 'in favour of Sapphire'}`,
    },
    { key: 'heroes', label: 'Hero lineup', logOdds: w[0] * heroL, detail: 'Current 30-day hero win rates at this skill level' },
    {
      key: 'networth', label: 'Souls lead', logOdds: nwL,
      detail: `${n0 === n1 ? 'Even' : `${formatSouls(Math.abs(n0 - n1))} ${n0 > n1 ? 'Amber' : 'Sapphire'} lead`}`,
    },
    {
      key: 'objectives', label: 'Objectives', logOdds: objL,
      detail: `Amber has destroyed ${sumLost(l1)}, Sapphire has destroyed ${sumLost(l0)}`,
    },
  ];

  const z = factors.reduce((a, f) => a + f.logOdds, 0);
  const liveAbs = Math.abs(nwL) + Math.abs(objL), preAbs = Math.abs(w[0] * (rankL + heroL));
  return {
    pTeam0: sigmoid(z),
    factors,
    liveShare: liveAbs + preAbs > 0 ? liveAbs / (liveAbs + preAbs) : 0,
  };
}

const sumLost = (l: ReturnType<typeof objectivesLost>) => l.t1 + l.t2 + l.bar + l.shr;

export function formatSouls(n: number) {
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}k` : `${n}`;
}

export const MODEL_INFO = { fittedOn: model.fittedOn };
