import type { Hero, Rank } from '../api';

export const TEAM_NAMES = ['Amber Hand', 'Sapphire Flame'] as const;
export const TEAM_CLASS = ['amber', 'sapphire'] as const;

export function HeroIcon({ id, heroes, size = 36 }: { id: number; heroes: Map<number, Hero>; size?: number }) {
  const h = heroes.get(id);
  const src = h?.images.icon_image_small_webp ?? h?.images.icon_image_small;
  return src
    ? <img className="hero-icon" src={src} alt={h?.name ?? ''} title={h?.name} width={size} height={size} loading="lazy" />
    : <span className="hero-icon placeholder" style={{ width: size, height: size }} title={`Hero ${id}`} />;
}

export function rankName(badge: number, ranks: Map<number, Rank>) {
  if (!badge) return 'Unranked';
  const tier = Math.floor(badge / 10), sub = badge % 10;
  return `${ranks.get(tier)?.name ?? `Tier ${tier}`} ${sub}`;
}

export function RankBadge({ badge, ranks, showName }: { badge: number; ranks: Map<number, Rank>; showName?: boolean }) {
  const tier = Math.floor(badge / 10), sub = badge % 10;
  const r = ranks.get(tier);
  const src = badge && r ? (r.images[`small_subrank${sub}_webp`] ?? r.images[`small_subrank${sub}`]) : undefined;
  return (
    <span className="rank" title={rankName(badge, ranks)}>
      {src ? <img src={src} alt="" width={22} height={22} /> : <span className="rank-none" aria-hidden>–</span>}
      {showName && <span>{rankName(badge, ranks)}</span>}
    </span>
  );
}

export function TeamLabel({ team, you }: { team: 0 | 1; you?: boolean }) {
  return (
    <span className="team-label">
      <span className={`swatch ${TEAM_CLASS[team]}`} aria-hidden />
      {TEAM_NAMES[team]}
      {you && <span className="you-chip">Your team</span>}
    </span>
  );
}

export const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
export const pct = (p: number) => `${Math.round(p * 100)}%`;

export function timeAgo(unix: number) {
  const s = Date.now() / 1000 - unix;
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

export const REGION: Record<string, string> = {
  row: 'NA / Rest of world', europe: 'Europe', se_asia: 'SE Asia', s_america: 'South America', russia: 'Russia', oceania: 'Oceania',
};
