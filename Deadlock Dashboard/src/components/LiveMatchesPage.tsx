import { useMemo, useState } from 'react';
import { api, type ActiveMatch } from '../api';
import { elapsedOf, isNormal, isRanked, modeLabel, predictMatch, useAssets, useAsync, useNow } from '../hooks';
import { formatSouls } from '../model/winProbability';
import { HeroIcon, REGION, TEAM_CLASS, clock, pct } from './common';

type ModeFilter = 'all' | 'ranked' | 'standard';
type SortKey = 'closest' | 'newest' | 'spectators';

export function LiveMatchesPage() {
  const live = useAsync(() => api.activeMatches(), [], 30_000);
  const [mode, setMode] = useState<ModeFilter>('all');
  const [region, setRegion] = useState('all');
  const [sort, setSort] = useState<SortKey>('closest');

  // Only standard 6v6 Ranked/Standard matches; Street Brawl isn't modelled.
  const matches = useMemo(() => (live.data ?? []).filter(isNormal), [live.data]);
  const regions = useMemo(() => [...new Set(matches.map(m => m.region_mode_parsed ?? ''))].filter(Boolean).sort(), [matches]);

  const rows = useMemo(() => {
    const nowS = Date.now() / 1000;
    return matches
      .filter(m => mode === 'all' || (mode === 'ranked') === isRanked(m))
      .filter(m => region === 'all' || m.region_mode_parsed === region)
      .map(m => ({ m, p: predictMatch(m, nowS)?.pTeam0 ?? 0.5 }))
      .sort((a, b) =>
        sort === 'closest' ? Math.abs(a.p - 0.5) - Math.abs(b.p - 0.5)
        : sort === 'newest' ? b.m.start_time - a.m.start_time
        : (b.m.spectators ?? 0) - (a.m.spectators ?? 0));
  }, [matches, mode, region, sort]);

  return (
    <section className="page">
      <div className="page-head">
        <h2>Live matches</h2>
        <span className="muted small">
          {live.data ? `${rows.length} of ${matches.length} matches · refreshes every 30s` : 'Loading…'}
        </span>
      </div>

      <div className="filters">
        <div className="segmented" role="group" aria-label="Mode">
          {(['all', 'ranked', 'standard'] as const).map(m => (
            <button key={m} className={mode === m ? 'on' : ''} onClick={() => setMode(m)}>
              {m === 'all' ? 'All' : m === 'ranked' ? 'Ranked' : 'Standard'}
            </button>
          ))}
        </div>
        <label>Region{' '}
          <select value={region} onChange={e => setRegion(e.target.value)}>
            <option value="all">All regions</option>
            {regions.map(r => <option key={r} value={r}>{REGION[r] ?? r}</option>)}
          </select>
        </label>
        <label>Sort{' '}
          <select value={sort} onChange={e => setSort(e.target.value as SortKey)}>
            <option value="closest">Closest odds</option>
            <option value="newest">Just started</option>
            <option value="spectators">Most watched</option>
          </select>
        </label>
      </div>

      {live.error && <div className="card error">{live.error.message}</div>}
      <p className="muted small">
        In this list, odds use hero lineups, souls and objectives only. Open a match to factor in player ranks.
      </p>
      <div className="match-list">
        {rows.map(({ m, p }) => <MatchRow key={m.match_id} m={m} p={p} />)}
      </div>
    </section>
  );
}

function MatchRow({ m, p }: { m: ActiveMatch; p: number }) {
  const assets = useAssets();
  const now = useNow();
  const team = (t: 0 | 1) => m.players.filter(pl => pl.team === t);
  return (
    <a className="match-row card" href={`#/match/${m.match_id}`}>
      <div className="mr-meta">
        <span className={`mode-chip ${modeLabel(m).toLowerCase()}`}>{modeLabel(m)}</span>
        <span className="clock">{clock(elapsedOf(m, now))}</span>
        <span className="muted small">{REGION[m.region_mode_parsed ?? ''] ?? m.region_mode_parsed}</span>
      </div>
      {([0, 1] as const).map(t => (
        <div key={t} className={`mr-team ${t === 1 ? 'right' : ''}`}>
          <div className="mr-heroes">
            {assets && team(t).map(pl => <HeroIcon key={pl.account_id} id={pl.hero_id} heroes={assets.heroes} size={30} />)}
          </div>
          <span className="muted small">{formatSouls(t === 0 ? m.net_worth_t0 : m.net_worth_t1)} souls</span>
        </div>
      ))}
      <div className="mr-odds">
        <div className="split-bar thin">
          <div className={`seg ${TEAM_CLASS[0]}`} style={{ width: `${p * 100}%` }} />
          <div className={`seg ${TEAM_CLASS[1]}`} style={{ width: `${(1 - p) * 100}%` }} />
          <div className="split-mid" aria-hidden />
        </div>
        <div className="split-labels small">
          <span>Amber <b>{pct(p)}</b></span>
          <span><b>{pct(1 - p)}</b> Sapphire</span>
        </div>
      </div>
    </a>
  );
}
