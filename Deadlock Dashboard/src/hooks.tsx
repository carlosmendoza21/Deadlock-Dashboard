import { useEffect, useMemo, useRef, useState } from 'react';
import { api, type ActiveMatch, type Hero, type PlayerHeroStats, type Rank, type SteamProfile } from './api';
import { heroWinRatesFor, isNormal, type PredictionInputs } from './predictMatch';

export { elapsedOf, isNormal, isRanked, modeLabel, predictMatch } from './predictMatch';

export interface AsyncState<T> {
  data: T | undefined;
  error: Error | undefined;
  loading: boolean;
  updatedAt: number | undefined;
}

/** Runs `fn` when deps change, and again every `intervalMs` if given. Keeps the last good data on error. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[], intervalMs?: number): AsyncState<T> {
  const [state, setState] = useState<AsyncState<T>>({ data: undefined, error: undefined, loading: true, updatedAt: undefined });
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    let cancelled = false;
    setState(s => ({ ...s, data: undefined, loading: true, error: undefined }));
    const run = () =>
      fnRef.current().then(
        data => !cancelled && setState({ data, error: undefined, loading: false, updatedAt: Date.now() }),
        error => !cancelled && setState(s => ({ ...s, error, loading: false })),
      );
    run();
    if (!intervalMs) return () => { cancelled = true; };
    const id = setInterval(() => { if (document.visibilityState === 'visible') run(); }, intervalMs);
    return () => { cancelled = true; clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, intervalMs]);

  return state;
}

/** Current unix time in seconds, ticking every second. */
export function useNow() {
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now() / 1000), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

export interface Assets {
  heroes: Map<number, Hero>;
  ranks: Map<number, Rank>;
}

let assetsPromise: Promise<Assets> | undefined;
export function loadAssets() {
  assetsPromise ??= Promise.all([api.heroes(), api.ranks()]).then(([heroes, ranks]) => ({
    heroes: new Map(heroes.map(h => [h.id, h])),
    ranks: new Map(ranks.map(r => [r.tier, r])),
  }));
  assetsPromise.catch(() => { assetsPromise = undefined; });
  return assetsPromise;
}
export const useAssets = () => useAsync(loadAssets, []).data;

/** Everything the dashboard needs about the people in a match. Fetched once per match, not on every poll. */
export interface MatchPeople extends PredictionInputs {
  profiles: Map<number, SteamProfile>;
  heroStats: Map<string, PlayerHeroStats>; // key `${account}:${hero}`
}

export function useMatchPeople(match: ActiveMatch | undefined) {
  const ids = match?.players.map(p => p.account_id) ?? [];
  const key = match ? `${match.match_id}:${ids.join(',')}` : '';
  return useAsync<MatchPeople | undefined>(async () => {
    if (!match) return undefined;
    const gameMode = isNormal(match) ? 'normal' : 'street_brawl';
    const [profiles, ranks, heroStats] = await Promise.all([
      api.steamProfiles(ids).catch(() => []),
      api.ranksOf(ids).catch(() => []),
      api.playerHeroStats(ids, gameMode).catch(() => []),
    ]);
    return {
      profiles: new Map(profiles.map(p => [p.account_id, p])),
      ranks: new Map(ranks.map(r => [r.account_id, r])),
      heroStats: new Map(heroStats.map(s => [`${s.account_id}:${s.hero_id}`, s])),
      heroWinRates: await heroWinRatesFor(ranks),
    };
  }, [key]);
}

/** Probability samples recorded while the page is open, persisted per match for the session. */
export function useProbabilityHistory(matchId: number | undefined, elapsedS: number | undefined, pTeam0: number | undefined) {
  const storageKey = `prob-history:${matchId}`;
  const [points, setPoints] = useState<{ t: number; p: number }[]>([]);

  useEffect(() => {
    if (matchId == null) return;
    try { setPoints(JSON.parse(sessionStorage.getItem(storageKey) ?? '[]')); } catch { setPoints([]); }
  }, [matchId, storageKey]);

  useEffect(() => {
    if (matchId == null || elapsedS == null || pTeam0 == null) return;
    setPoints(prev => {
      const last = prev[prev.length - 1];
      if (last && elapsedS - last.t < 10) return prev; // one sample per poll at most
      const next = [...prev, { t: elapsedS, p: pTeam0 }];
      try { sessionStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* storage unavailable */ }
      return next;
    });
  }, [matchId, elapsedS, pTeam0, storageKey]);

  return useMemo(() => points, [points]);
}
