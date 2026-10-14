import type { ActiveMatch } from '../api';
import type { Assets, MatchPeople } from '../hooks';
import { HeroIcon, RankBadge, TeamLabel, rankName } from './common';

export function TeamRoster({ match, team, viewerId, people, assets }: {
  match: ActiveMatch; team: 0 | 1; viewerId?: number; people?: MatchPeople; assets?: Assets;
}) {
  const players = match.players.filter(p => p.team === team);
  const isYours = players.some(p => p.account_id === viewerId);

  return (
    <div className="card roster">
      <div className="card-head">
        <TeamLabel team={team} you={isYours} />
      </div>
      <table>
        <thead>
          <tr><th>Player</th><th>Rank</th><th className="num" title="This player's record on this hero">On hero</th></tr>
        </thead>
        <tbody>
          {players.map(p => {
            const profile = people?.profiles.get(p.account_id);
            const rank = people?.ranks.get(p.account_id);
            const stats = people?.heroStats.get(`${p.account_id}:${p.hero_id}`);
            const hero = assets?.heroes.get(p.hero_id);
            return (
              <tr key={p.account_id} className={p.account_id === viewerId ? 'viewer' : ''}>
                <td>
                  <a className="player-cell" href={`#/player/${p.account_id}`}>
                    {assets && <HeroIcon id={p.hero_id} heroes={assets.heroes} size={36} />}
                    <span>
                      <b>{profile?.profileurl ?? `Player ${p.account_id}`}</b>
                      <span className="muted small">{hero?.name ?? `Hero ${p.hero_id}`}{p.abandoned ? ' · left the match' : ''}</span>
                    </span>
                  </a>
                </td>
                <td>
                  {rank && assets
                    ? <span className="rank-cell"><RankBadge badge={rank.badge} ranks={assets.ranks} /><span className="small">{rankName(rank.badge, assets.ranks)}</span></span>
                    : <span className="muted">–</span>}
                </td>
                <td className="num">
                  {stats && stats.matches_played > 0 ? (
                    <span title={`${stats.wins} wins in ${stats.matches_played} matches`}>
                      {Math.round((stats.wins / stats.matches_played) * 100)}%
                      <span className="muted small"> · {stats.matches_played} games</span>
                    </span>
                  ) : <span className="muted small">{people ? 'no record' : '…'}</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
