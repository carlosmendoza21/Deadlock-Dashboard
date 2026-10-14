// Turns an active match plus fetched player/hero data into a prediction.
// Shared by the React app and scripts/backtest.ts, so the backtest scores exactly what users see.
import { api, type AccountRank, type ActiveMatch, GAME_MODE, MATCH_MODE } from './api';
import { badgeToSkill, heroStrength, predict, smoothedWinRate, type Prediction } from './model/winProbability';

export const isRanked = (m: { match_mode: number }) => m.match_mode === MATCH_MODE.Ranked;
export const isNormal = (m: { game_mode: number }) => m.game_mode === GAME_MODE.Normal;
export const modeLabel = (m: { match_mode: number }) => (isRanked(m) ? 'Ranked' : 'Standard');
export const elapsedOf = (m: ActiveMatch, now: number) => Math.max(0, m.duration_s ?? now - m.start_time);

/** The fetched data the prediction needs beyond the match itself. */
export interface PredictionInputs {
  ranks: Map<number, AccountRank>;
  heroWinRates: Map<number, number>;
}

/** Hero win rates for the skill range of the given players (all ranks if none are known). */
export async function heroWinRatesFor(ranks: AccountRank[]) {
  const known = ranks.filter(r => r.badge > 0);
  const avgBadge = known.length ? known.reduce((a, r) => a + r.badge, 0) / known.length : undefined;
  const rates = await (avgBadge
    ? api.heroWinRates(Math.max(0, Math.round(avgBadge - 10)), Math.round(avgBadge + 10))
    : api.heroWinRates()
  ).catch(() => []);
  return new Map(rates.map(r => [r.hero_id, smoothedWinRate(r.wins, r.matches)]));
}

/** Team-average skill in subrank units; null unless at least 4 players on the team have a known rank. */
export function teamSkill(match: ActiveMatch, team: 0 | 1, ranks: Map<number, AccountRank> | undefined) {
  const badges = match.players
    .filter(p => p.team === team)
    .map(p => ranks?.get(p.account_id)?.badge ?? 0)
    .filter(b => b > 0);
  return badges.length >= 4 ? badges.reduce((a, b) => a + badgeToSkill(b), 0) / badges.length : null;
}

/** `elapsedOverride` lets callers predict as if at another game time (e.g. 0 for the pre-game estimate). */
export function predictMatch(match: ActiveMatch, now: number, inputs?: PredictionInputs, elapsedOverride?: number): Prediction | null {
  if (!isNormal(match)) return null;
  const heroes = (t: 0 | 1) => match.players.filter(p => p.team === t).map(p => p.hero_id);
  const rates = inputs?.heroWinRates ?? new Map<number, number>();
  return predict({
    elapsedS: elapsedOverride ?? elapsedOf(match, now),
    netWorth: [match.net_worth_team_0, match.net_worth_team_1],
    objectivesMask: [match.objectives_mask_team0, match.objectives_mask_team1],
    avgSkill: [teamSkill(match, 0, inputs?.ranks), teamSkill(match, 1, inputs?.ranks)],
    heroStrength: [heroStrength(heroes(0), rates), heroStrength(heroes(1), rates)],
    ranked: isRanked(match),
  });
}
