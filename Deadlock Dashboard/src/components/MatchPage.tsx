import { api } from '../api';
import { useAsync } from '../hooks';
import { MatchDashboard } from './MatchDashboard';

export function MatchPage({ matchId }: { matchId: number }) {
  const live = useAsync(() => api.activeMatches(), [], 20_000);
  const match = live.data?.find(m => m.match_id === matchId);

  return (
    <section className="page">
      <p><a href="#/live">← All live matches</a></p>
      {live.loading && !live.data && <div className="card muted">Loading match…</div>}
      {live.error && !live.data && <div className="card error">{live.error.message}</div>}
      {live.data && !match && (
        <div className="card not-live">
          <span className="status-dot idle" aria-hidden /> <b>This match is no longer live.</b>{' '}
          <span className="muted">It has probably ended, or dropped out of the Watch tab.</span>
        </div>
      )}
      {match && <MatchDashboard match={match} updatedAt={live.updatedAt} />}
    </section>
  );
}
