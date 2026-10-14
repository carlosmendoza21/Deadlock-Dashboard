import type { ActiveMatch } from '../api';
import { LANES, OBJECTIVES, formatSouls, isStanding } from '../model/winProbability';
import { TEAM_CLASS, TeamLabel } from './common';

const TIERS = [
  { key: 't1', name: 'Guardian' },
  { key: 't2', name: 'Walker' },
  { key: 'bar', name: 'Base Guardian' },
] as const;

export function ObjectivesPanel({ match, side }: { match: ActiveMatch; side: 0 | 1 }) {
  const nw = [match.net_worth_team_0, match.net_worth_team_1];
  const masks = [match.objectives_mask_team0, match.objectives_mask_team1];
  const order = [side, (1 - side) as 0 | 1] as const;
  const lead = nw[side] - nw[1 - side];

  return (
    <div className="card">
      <div className="card-head">
        <h3>Souls & objectives</h3>
        <span className="muted small">
          {lead === 0 ? 'Souls even' : `${formatSouls(Math.abs(lead))} souls ${lead > 0 ? 'ahead' : 'behind'}`}
        </span>
      </div>

      <div className="souls">
        {order.map(team => (
          <div key={team} className="souls-row">
            <TeamLabel team={team} />
            <div className="souls-track">
              <div className={`souls-bar ${TEAM_CLASS[team]}`} style={{ width: `${(nw[team] / Math.max(1, ...nw)) * 100}%` }} />
            </div>
            <b className="num">{formatSouls(nw[team])}</b>
          </div>
        ))}
      </div>

      <div className="objectives">
        {order.map(team => (
          <div key={team} className="obj-team">
            <TeamLabel team={team} />
            <table className="obj-table">
              <thead>
                <tr><th>Lane</th>{TIERS.map(t => <th key={t.key}>{t.name}</th>)}</tr>
              </thead>
              <tbody>
                {LANES.map(l => (
                  <tr key={l.lane}>
                    <td>{l.name}</td>
                    {TIERS.map(t => <td key={t.key}><Pip standing={isStanding(masks[team], l[t.key])} label={`${l.name} ${t.name}`} team={team} /></td>)}
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="obj-base">
              <span>Shrines {OBJECTIVES.shr.map(b => <Pip key={b} standing={isStanding(masks[team], b)} label="Shrine" team={team} />)}</span>
              <span>Patron <Pip standing={isStanding(masks[team], OBJECTIVES.titan[0])} label="Patron" team={team} /></span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Pip({ standing, label, team }: { standing: boolean; label: string; team: 0 | 1 }) {
  return (
    <span
      className={`pip ${TEAM_CLASS[team]} ${standing ? 'up' : 'down'}`}
      title={`${label}: ${standing ? 'standing' : 'destroyed'}`}
      aria-label={`${label} ${standing ? 'standing' : 'destroyed'}`}
    >
      {standing ? '' : '✕'}
    </span>
  );
}
