import { RANK_TIERS, TIER_FLOORS, rankInfo, type RankTier } from "@cpt/shared";

const TIER_STYLE: Record<RankTier, string> = {
  BRONZE: "border-amber-700/60 bg-amber-900/30 text-amber-300",
  SILVER: "border-slate-400/50 bg-slate-500/15 text-slate-200",
  GOLD: "border-yellow-500/60 bg-yellow-500/10 text-yellow-300",
  PLATINUM: "border-teal-400/50 bg-teal-400/10 text-teal-200",
  DIAMOND: "border-sky-400/60 bg-sky-400/10 text-sky-300",
  MASTER: "border-fuchsia-400/60 bg-fuchsia-400/10 text-fuchsia-300",
  CCIE: "border-rose-500/60 bg-rose-500/15 text-rose-300",
};

export function RankBadge({ elo, size = "md" }: { elo: number; size?: "sm" | "md" | "lg" }) {
  const info = rankInfo(elo);
  const sizing = { sm: "px-1.5 py-0.5 text-[11px]", md: "px-2 py-0.5 text-xs", lg: "px-3 py-1 text-sm" }[size];
  return (
    <span className={`inline-flex items-center gap-1 rounded border font-semibold ${sizing} ${TIER_STYLE[info.tier]}`}>
      <span aria-hidden>◆</span>
      {info.label}
    </span>
  );
}

/** Progress (0-1) from the current tier floor to the next one. */
export function tierProgress(elo: number): { next: RankTier | null; progress: number; remaining: number } {
  const { tier } = rankInfo(elo);
  const next = RANK_TIERS[RANK_TIERS.indexOf(tier) + 1] ?? null;
  if (!next) return { next: null, progress: 1, remaining: 0 };
  const floor = Math.min(TIER_FLOORS[tier], elo);
  const span = TIER_FLOORS[next] - floor;
  return { next, progress: (elo - floor) / span, remaining: TIER_FLOORS[next] - elo };
}
