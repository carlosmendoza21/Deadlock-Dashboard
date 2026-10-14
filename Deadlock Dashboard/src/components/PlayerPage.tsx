import { api, GAME_MODE, MATCH_MODE } from '../api';
import { useAssets, useAsync } from '../hooks';
import { MatchDashboard } from './MatchDashboard';
import { HeroIcon, RankBadge, timeAgo } from './common';

const POLL_MS = 20_000;

export function PlayerPage({ accountId }: { accountId: number }) {
  const assets = useAssets();
  const profile = useAsync(() => api.steamProfiles([accountId]).then(p => p[0]), [accountId]);
  const rank = useAsync(() => api.ranksOf([accountId]).then(r => r[0]), [accountId]);
  const live = useAsync(() => api.activeMatches(accountId), [accountId], POLL_MS);

  const match = live.data?.find(m => m.players.some(p => p.account_id === accountId));

  return (
    <section className="page">
      <div className="player-head">
        {profile.data?.avatar && <img className="avatar" src={profile.data.avatar} alt="" width={56} height={56} />}
        <div>
          <h2>{profile.data?.personaname ??`Player ${accountId}`}</h2>
          <div className="muted small">
            Account {accountId}
            {profile.data?.profileurl && <> · <a href={profile.data.profileurl} target="_blank" rel="noreferrer">Steam profile</a></>}
          </div>
        </div>
        <div className="spacer" />
        {rank.data && assets && <RankBadge badge={rank.data.badge} ranks={assets.ranks} showName />}
      </div>

      {live.loading && !live.data && <div className="card muted">Checking for a live match…</div>}
      {live.error && !live.data && <div className="card error">{live.error.message}</div>}

      {match && <MatchDashboard match={match} viewerId={accountId} updatedAt={live.updatedAt} />}

      {live.data && !match && (
        <>
          <div className="card not-live">
            <span className="status-dot idle" aria-hidden /> <b>No live match found.</b>{' '}
            <span className="muted">
              Either this player isn't in a match, or their match isn't in the in-game Watch tab (it only lists the
              top few hundred live matches). This page checks again every {POLL_MS / 1000} seconds.
            </span>
          </div>
          <RecentMatches accountId={accountId} />
        </>
      )}
    </section>
  );
}

function RecentMatches({ accountId }: { accountId: number }) {
  const assets = useAssets();
  const { data, error, loading } = useAsync(() => api.matchHistory(accountId), [accountId]);
  const rows = (data ?? [])
    .filter(m => m.game_mode === GAME_MODE.Normal && (m.match_mode === MATCH_MODE.Ranked || m.match_mode === MATCH_MODE.Unranked))
    .slice(0, 15);
  const wins = rows.filter(m => m.match_result === m.player_team).length;

  return (
    <div className="card">
      <div className="card-head">
        <h3>Recent matches</h3>
        {rows.length > 0 && <span className="muted small">{wins}W – {rows.length - wins}L in the last {rows.length}</span>}
      </div>
      {loading && <p className="muted">Loading…</p>}
      {error && <p className="error">{error.message}</p>}
      {data && rows.length === 0 && <p className="muted">No recent Ranked or Standard matches on record.</p>}
      {rows.length > 0 && (
        <div className="table-scroll"><table className="history">
          <thead>
            <tr><th>Hero</th><th>Result</th><th>Mode</th><th className="num">K / D / A</th><th className="num">Souls</th><th className="num">Length</th><th className="num">When</th></tr>
          </thead>
          <tbody>
            {rows.map(m => {
              const won = m.match_result === m.player_team;
              return (
                <tr key={m.match_id}>
                  <td><span className="hero-cell">{assets && <HeroIcon id={m.hero_id} heroes={assets.heroes} size={28} />}{assets?.heroes.get(m.hero_id)?.name ?? `Hero ${m.hero_id}`}</span></td>
                  <td><span className={`result ${won ? 'win' : 'loss'}`}>{won ? '▲ Win' : '▼ Loss'}</span></td>
                  <td>{m.match_mode === MATCH_MODE.Ranked ? 'Ranked' : 'Standard'}</td>
                  <td className="num">{m.player_kills} / {m.player_deaths} / {m.player_assists}</td>
                  <td className="num">{(m.net_worth / 1000).toFixed(1)}k</td>
                  <td className="num">{Math.round(m.match_duration_s / 60)}m</td>
                  <td className="num muted">{timeAgo(m.start_time)}</td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
      )}
    </div>
  );
}
