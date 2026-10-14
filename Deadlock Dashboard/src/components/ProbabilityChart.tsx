import { useRef, useState } from 'react';
import { TEAM_CLASS, TEAM_NAMES, clock, pct } from './common';

const W = 560, H = 220;
const M = { top: 12, right: 16, bottom: 28, left: 40 };

/** Win chance for `side` over match time. Single series, so no legend: the card title names it. */
export function ProbabilityChart({ points, side }: { points: { t: number; p: number }[]; side: 0 | 1 }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);

  if (points.length < 2) {
    return (
      <div className="chart-empty muted">
        The line fills in as new data arrives, roughly every 20 seconds. Keep this page open to watch momentum shift.
      </div>
    );
  }

  const data = points.map(d => ({ t: d.t, p: side === 0 ? d.p : 1 - d.p }));
  const t0 = Math.min(...data.map(d => d.t)), t1 = Math.max(...data.map(d => d.t), t0 + 60);
  const x = (t: number) => M.left + ((t - t0) / (t1 - t0)) * (W - M.left - M.right);
  const y = (p: number) => M.top + (1 - p) * (H - M.top - M.bottom);

  const line = data.map((d, i) => `${i ? 'L' : 'M'}${x(d.t).toFixed(1)},${y(d.p).toFixed(1)}`).join('');
  const area = `${line}L${x(data[data.length - 1].t)},${y(0.5)}L${x(data[0].t)},${y(0.5)}Z`;

  const step = niceMinuteStep((t1 - t0) / 60);
  const ticks: number[] = [];
  for (let m = Math.ceil(t0 / 60 / step) * step; m * 60 <= t1; m += step) ticks.push(m * 60);

  const onMove = (e: React.PointerEvent) => {
    const r = svgRef.current!.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    let best = 0;
    data.forEach((d, i) => { if (Math.abs(x(d.t) - px) < Math.abs(x(data[best].t) - px)) best = i; });
    setHover(best);
  };
  const h = hover != null ? data[hover] : null;
  const last = data[data.length - 1];

  return (
    <div className="chart">
      <svg
        ref={svgRef} viewBox={`0 0 ${W} ${H}`} className={`prob-chart ${TEAM_CLASS[side]}`}
        onPointerMove={onMove} onPointerLeave={() => setHover(null)}
        role="img" aria-label={`${TEAM_NAMES[side]} win chance over time, now ${pct(last.p)}`}
      >
        {[0, 0.25, 0.5, 0.75, 1].map(p => (
          <g key={p}>
            <line className={p === 0.5 ? 'ref-line' : 'grid-line'} x1={M.left} x2={W - M.right} y1={y(p)} y2={y(p)} />
            <text className="axis-text" x={M.left - 6} y={y(p) + 4} textAnchor="end">{p * 100}%</text>
          </g>
        ))}
        {ticks.map(t => (
          <text key={t} className="axis-text" x={x(t)} y={H - 8} textAnchor="middle">{t / 60}m</text>
        ))}
        <path className="series-area" d={area} />
        <path className="series-line" d={line} />
        <circle className="series-dot" cx={x(last.t)} cy={y(last.p)} r={4} />
        <text className="direct-label" x={x(last.t) - 8} y={y(last.p) + (last.p > 0.85 ? 18 : -10)} textAnchor="end">{pct(last.p)}</text>
        {h && (
          <g pointerEvents="none">
            <line className="crosshair" x1={x(h.t)} x2={x(h.t)} y1={M.top} y2={H - M.bottom} />
            <circle className="series-dot" cx={x(h.t)} cy={y(h.p)} r={5} />
          </g>
        )}
        <rect x={M.left} y={M.top} width={W - M.left - M.right} height={H - M.top - M.bottom} fill="transparent" />
      </svg>
      {h && (
        <div className="tooltip" style={{ left: `${(x(h.t) / W) * 100}%` }}>
          <span className="muted">{clock(h.t)}</span> <b>{pct(h.p)}</b>
        </div>
      )}
      <details className="table-view">
        <summary>Show as table</summary>
        <table>
          <thead><tr><th>Match time</th><th className="num">{TEAM_NAMES[side]} win chance</th></tr></thead>
          <tbody>{data.map(d => <tr key={d.t}><td>{clock(d.t)}</td><td className="num">{pct(d.p)}</td></tr>)}</tbody>
        </table>
      </details>
    </div>
  );
}

function niceMinuteStep(spanMin: number) {
  for (const s of [1, 2, 5, 10]) if (spanMin / s <= 6) return s;
  return 15;
}
