const BASE = 'https://api.deadlock-api.com';

export type Matchmode = 'Unranked' | 'Ranked' | string;

export interface ActiveMatchPlayer {
    account_id: number;
    team: 0 | 1;
    hero_id: number;
    abandoned: boolean | null;
}

export interface ActiveMatch{
    match_id: number;
    lobby_id: number | null;
    start_time: number;
    duration_s: number | null;
    match_mode: number;
    match_mode_parsed: Matchmode;
    game_mode: number;
    game_mode_parsed: string;
    region_mode_parsed: string | null;
    net_worth_t0: number;
    net_worth_t1: number;
    obj_mask_t0: number;
    obj_mask_t1: number;
    spectators: number | null;
    match_score: number | null;
    players: ActiveMatchPlayer[];
}

export interface Hero{
    id: number;
    name: string;
    images: Record<string, string>;
}

export interface Rank{
    tier: number;
    name: string;
    color: string;
    images: Record<string, string>;
}

export interface AccountRank{
    account_id: number;
    badge: number;
    rank: number;
    subrank: number;
}

export interface SteamProfile{
    account_id: number;
    username: string;
    avatar: string;
    profileurl: string;
}

export interface PlayerHeroStats {
    account_id: number;
    hero_id: number;
    matches_played: number;
    wins: number;
    kills: number;
    deaths: number;
    assists: number;
}

export interface AnalyticsHeroStats{
    hero_id: number;
    wins: number;
    losses: number;
    matches: number;
}

export interface MatchHistoryEntry{
    match_id: number;
    hero_id: number;
    start_time: number;
    game_mode: number;
    match_mode: number;
    player_team: number;
    player_kills: number;
    player_deaths: number;
    player_assists: number;
    net_worth: number;
    match_duration_s: number;
    match_result: number;
    player_match_outcome: number | null;
    ranked_display_badge: number | null;
}

/** comes from deadlock api values */
export const MATCH_MODE = {Unranked: 1, Ranked: 4} as const;

export const GAME_MODE = {Normal: 1, StreetBrawl: 4} as const;

const cache = new Map<string, {at: number; data: Promise<unknown>}>();

async function get<T>(path: string, params: Record<string, string | number | undefined> = {}, ttlMs = 0): Promise<T> {
  const qs = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join('&');
  const url = `${BASE}${path}${qs ? `?${qs}` : ''}`;
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < ttlMs) return hit.data as Promise<T>;

  const attempt = () => fetch(url).then(async res => {
    if (res.status === 429) throw new Error('The Deadlock API is rate limiting us. Wait a minute and try again.');
    if (!res.ok) throw new Error(`Deadlock API error ${res.status} on ${path}`);
    return res.json(); // occasionally a 200 arrives truncated; that throws a SyntaxError and is retried below
  });
  const data = attempt().catch(e => (e instanceof SyntaxError ? attempt() : Promise.reject(e)));
  if (ttlMs > 0) {
    cache.set(url, { at: Date.now(), data });
    data.catch(() => cache.delete(url));
  }
  return data as Promise<T>;
}

const MIN = 60_000;
const HOUR = 60 * MIN;

// Different URLs (e.g. filtered by account_id vs. the full list) can serve snapshots of different ages.
// Souls only ever go up during a match, so keep the freshest snapshot seen per match and never step back.
const freshest = new Map<number, ActiveMatch>();
const totalSouls = (m: ActiveMatch) => m.net_worth_t0 + m.net_worth_t1;
function newestSnapshots(matches: ActiveMatch[]) {
  return matches.map(m => {
    const prev = freshest.get(m.match_id);
    if (prev && totalSouls(prev) > totalSouls(m)) return prev;
    freshest.set(m.match_id, m);
    return m;
  });
}

export const api = {
  activeMatches: (accountId?: number) =>
    get<ActiveMatch[]>('/v1/matches/active', { account_id: accountId }, 15_000).then(newestSnapshots),

  heroes: () => get<Hero[]>('/v1/assets/heroes', { only_active: 'true' }, 24 * HOUR),
  ranks: () => get<Rank[]>('/v1/assets/ranks', {}, 24 * HOUR),

  ranksOf: (ids: number[]) =>
    ids.length ? get<AccountRank[]>('/v1/players/rank', { account_ids: [...ids].sort().join(',') }, 10 * MIN) : Promise.resolve([]),

  steamProfiles: (ids: number[]) =>
    ids.length ? get<SteamProfile[]>('/v1/players/steam', { account_ids: [...ids].sort().join(',') }, HOUR) : Promise.resolve([]),

  steamSearch: (q: string) => get<SteamProfile[]>('/v1/players/steam-search', { search_query: q, limit: 10 }, 5 * MIN),

  playerHeroStats: (ids: number[], gameMode: 'normal' | 'street_brawl' = 'normal') =>
    get<PlayerHeroStats[]>('/v1/players/hero-stats', { account_ids: [...ids].sort().join(','), game_mode: gameMode }, 30 * MIN),

  /** Global hero win rates over the last 30 days, optionally for a badge range. */
  heroWinRates: (minBadge?: number, maxBadge?: number) => {
    const day = 86_400;
    const since = Math.floor(Date.now() / 1000 / day) * day - 30 * day; // day-aligned so the URL caches
    return get<AnalyticsHeroStats[]>('/v1/analytics/hero-stats', {
      game_mode: 'normal', min_unix_timestamp: since, min_average_badge: minBadge, max_average_badge: maxBadge,
    }, 6 * HOUR);
  },

  matchHistory: (accountId: number) =>
    get<MatchHistoryEntry[]>(`/v1/players/${accountId}/match-history`, {}, 2 * MIN),

  /** Results of finished matches (up to 100 ids). Matches not yet ingested by the API are simply missing. */
  matchResults: (matchIds: number[]) =>
    get<MatchResult[]>('/v1/matches/metadata', { match_ids: matchIds.join(','), include_info: 'true', limit: 100 }),
};

export interface MatchResult {
  match_id: number;
  winning_team: 'Team0' | 'Team1' | string;
  match_outcome: 'TeamWin' | string;
  not_scored: boolean | null;
}

/** Steam IDs: accepts account id, SteamID64, [U:1:x], or a /profiles/ URL. Returns null for names/vanity URLs. */
export function parseAccountId(input: string): number | null {
  const s = input.trim();
  const STEAM64_BASE = 76561197960265728n;
  const steam64 = s.match(/(?:profiles\/)?(7656119\d{10})/);
  if (steam64) return Number(BigInt(steam64[1]) - STEAM64_BASE);
  const u = s.match(/\[U:1:(\d+)\]/);
  if (u) return Number(u[1]);
  if (/^\d{1,10}$/.test(s) && Number(s) < 2 ** 32) return Number(s);
  return null;
}

export function vanityFromUrl(input: string): string | null {
  return input.match(/steamcommunity\.com\/id\/([^/?#]+)/)?.[1] ?? null;
}