import { useMemo } from 'react';
import type { ActiveMatch } from '../api';
import {
  elapsedOf, isNormal, modeLabel, predictMatch, useAssets, useMatchPeople, useNow, useProbabilityHistory,
} from '../hooks';
import { MODEL_INFO, type Prediction } from '../model/winProbability';
import { REGION, TEAM_CLASS, TEAM_NAMES, TeamLabel, clock, pct } from './common';
import { ProbabilityChart } from './ProbabilityChart.tsx';
import { ObjectivesPanel } from './ObjectivesPanel.tsx';
import { TeamRoster } from './TeamRoster.tsx';

export function MatchDashboard({ match, viewerId, updatedAt }: { match: ActiveMatch; viewerId?: number; updatedAt?: number }) {
  const assets = useAssets();
  const now = useNow();
  const people = useMatchPeople(match);

  const viewerTeam = match.players.find(p => p.account_id === viewerId)?.team;
  const side: 0 | 1 = viewerTeam ?? 0;

  // Predict at poll time, not on every clock tick, so the number only moves when new data arrives.
  const pollElapsed = useMemo(() => elapsedOf(match, Date.now() / 1000), [match]);
  const prediction = useMemo(
    () => predictMatch(match, match.start_time + pollElapsed, people.data),
    [match, pollElapsed, people.data],
  );
  const history = useProbabilityHistory(match.match_id, prediction ? pollElapsed : undefined, prediction?.pTeam0);

  const p = prediction ? (side === 0 ? prediction.pTeam0 : 1 - prediction.pTeam0) : undefined;

  return (
    <div className="dashboard">
      <div className="match-head card">
        <span className="live-pill"><span className="status-dot live" aria-hidden />Live</span>
        <span className={`mode-chip ${modeLabel(match).toLowerCase()}`}>{modeLabel(match)}</span>
        {!isNormal(match) && <span className="mode-chip">Street Brawl</span>}
        <span className="muted">{REGION[match.region_mode_parsed ?? ''] ?? match.region_mode_parsed}</span>
        <span className="clock" title="Time since match start">{clock(elapsedOf(match, now))}</span>
        <span className="spacer" />
        <span className="muted small">
          Match {match.match_id}
          {updatedAt && <> · updated {Math.max(0, Math.round((Date.now() - updatedAt) / 1000))}s ago</>}
        </span>
      </div>

      {prediction && p != null ? (
        <div className="grid-2">
          <div className="card odds">
            <div className="odds-hero">
              <div className="big-number">{pct(p)}</div>
              <div>
                <div className="odds-caption">
                  {viewerTeam != null ? 'chance your team wins' : <>chance <TeamLabel team={side} /> wins</>}
                </div>
                {viewerTeam != null && <TeamLabel team={side} you />}
              </div>
            </div>
            <SplitBar pTeam0={prediction.pTeam0} />
            <FactorBars prediction={prediction} side={side} />
            <p className="fineprint">
              Based on {MODEL_INFO.fittedOn.toLocaleString()} recent matches.{' '}
              {people.loading && 'Loading player ranks and hero stats… '}
              Watch-tab data can lag the real game by a minute or two.
            </p>
          </div>
          <div className="card">
            <div className="card-head">
              <h3>Win chance over time</h3>
              <span className="muted small">recorded while this page is open</span>
            </div>
            <ProbabilityChart points={history} side={side} />
          </div>
        </div>
      ) : (
        <div className="card muted">
          Win chance is only available for standard 6v6 matches. Street Brawl uses different rules, so the model doesn't cover it.
        </div>
      )}

      {isNormal(match) && <ObjectivesPanel match={match} side={side} />}

      <div className="grid-2">
        {([side, (1 - side) as 0 | 1] as const).map(team => (
          <TeamRoster key={team} match={match} team={team} viewerId={viewerId} people={people.data} assets={assets} />
        ))}
      </div>
    </div>
  );
}

function SplitBar({ pTeam0 }: { pTeam0: number }) {
  return (
    <div className="split" role="img" aria-label={`${TEAM_NAMES[0]} ${pct(pTeam0)}, ${TEAM_NAMES[1]} ${pct(1 - pTeam0)}`}>
      <div className="split-bar">
        <div className={`seg ${TEAM_CLASS[0]}`} style={{ width: `${pTeam0 * 100}%` }} />
        <div className={`seg ${TEAM_CLASS[1]}`} style={{ width: `${(1 - pTeam0) * 100}%` }} />
        <div className="split-mid" aria-hidden />
      </div>
      <div className="split-labels">
        <span><TeamLabel team={0} /> <b>{pct(pTeam0)}</b></span>
        <span><b>{pct(1 - pTeam0)}</b> <TeamLabel team={1} /></span>
      </div>
    </div>
  );
}

/** Each factor's effect on the win chance: how far the final number would move without it. */
function FactorBars({ prediction, side }: { prediction: Prediction; side: 0 | 1 }) {
  const z = prediction.factors.reduce((a, f) => a + f.logOdds, 0);
  const sig = (x: number) => 1 / (1 + Math.exp(-x));
  const rows = prediction.factors.map(f => {
    const shiftTeam0 = sig(z) - sig(z - f.logOdds);
    return { ...f, pts: (side === 0 ? shiftTeam0 : -shiftTeam0) * 100, favours: (shiftTeam0 >= 0 ? 0 : 1) as 0 | 1 };
  });
  const maxPts = Math.max(10, ...rows.map(r => Math.abs(r.pts)));

  return (
    <div className="factors">
      <div className="factors-axis muted small">
        <span>favours {TEAM_NAMES[(1 - side) as 0 | 1]}</span>
        <span>favours {TEAM_NAMES[side]}</span>
      </div>
      {rows.map(r => {
        const w = (Math.abs(r.pts) / maxPts) * 50;
        const right = r.pts >= 0;
        const rounded = Math.round(r.pts);
        return (
          <div className="factor" key={r.key} title={r.detail}>
            <div className="factor-label">
              <span>{r.label}</span>
              <span className="factor-pts">{rounded === 0 ? '±0' : `${rounded > 0 ? '+' : '−'}${Math.abs(rounded)}`} pts</span>
            </div>
            <div className="factor-track">
              <div className="factor-mid" />
              {Math.abs(r.pts) >= 0.5 && (
                <div
                  className={`factor-bar ${TEAM_CLASS[r.favours]} ${right ? 'right' : 'left'}`}
                  style={right ? { left: '50%', width: `${w}%` } : { right: '50%', width: `${w}%` }}
                />
              )}
            </div>
            <div className="factor-detail muted small">{r.detail}</div>
          </div>
        );
      })}
    </div>
  );
}

