/**
 * ELO rating + rank tiers. Kept deliberately simple for v0; the model stores
 * rating deviation / volatility so we can switch to Glicko-2 without a
 * schema migration.
 */

export const RANK_TIERS = [
  "BRONZE",
  "SILVER",
  "GOLD",
  "PLATINUM",
  "DIAMOND",
  "MASTER",
  "CCIE",
] as const;

export type RankTier = (typeof RANK_TIERS)[number];

/**
 * Lower bound (inclusive) of each tier. Anything below the Bronze floor is
 * still Bronze III. New players (1000) start in Bronze II.
 */
export const TIER_FLOORS: Record<RankTier, number> = {
  BRONZE: 800,
  SILVER: 1150,
  GOLD: 1300,
  PLATINUM: 1450,
  DIAMOND: 1650,
  MASTER: 1850,
  CCIE: 2100,
};

export const DEFAULT_RATING = 1000;

/** Tiers below MASTER are split in divisions III, II, I (I being highest). */
const DIVISIONS = ["III", "II", "I"] as const;

export interface RankInfo {
  tier: RankTier;
  division: (typeof DIVISIONS)[number] | null;
  label: string;
}

export function tierForRating(rating: number): RankTier {
  let tier: RankTier = "BRONZE";
  for (const t of RANK_TIERS) {
    if (rating >= TIER_FLOORS[t]) tier = t;
  }
  return tier;
}

export function rankInfo(rating: number): RankInfo {
  const tier = tierForRating(rating);
  const idx = RANK_TIERS.indexOf(tier);
  const next = RANK_TIERS[idx + 1];
  const pretty = tier === "CCIE" ? "CCIE" : tier[0] + tier.slice(1).toLowerCase();
  if (tier === "MASTER" || tier === "CCIE" || next === undefined) {
    return { tier, division: null, label: pretty };
  }
  const floor = TIER_FLOORS[tier];
  const span = TIER_FLOORS[next] - floor;
  const step = Math.min(DIVISIONS.length - 1, Math.floor(((rating - floor) / span) * DIVISIONS.length));
  const division = DIVISIONS[Math.max(0, step)]!;
  return { tier, division, label: `${pretty} ${division}` };
}

export function expectedScore(rating: number, opponent: number): number {
  return 1 / (1 + 10 ** ((opponent - rating) / 400));
}

/** K-factor: provisional players move faster. */
export function kFactor(rating: number, gamesPlayed: number): number {
  if (gamesPlayed < 20) return 40;
  if (rating >= TIER_FLOORS.MASTER) return 16;
  return 24;
}

export interface EloUpdate {
  winnerDelta: number;
  loserDelta: number;
}

/** Rating delta for one player given their score (1 win, 0.5 draw, 0 loss). */
export function eloDelta(
  player: { rating: number; gamesPlayed: number },
  opponent: { rating: number },
  score: 0 | 0.5 | 1,
): number {
  return Math.round(kFactor(player.rating, player.gamesPlayed) * (score - expectedScore(player.rating, opponent.rating)));
}

/** Returns rating deltas for a decisive 1v1 result. */
export function eloUpdate(
  winner: { rating: number; gamesPlayed: number },
  loser: { rating: number; gamesPlayed: number },
): EloUpdate {
  const ew = expectedScore(winner.rating, loser.rating);
  const el = expectedScore(loser.rating, winner.rating);
  return {
    winnerDelta: Math.round(kFactor(winner.rating, winner.gamesPlayed) * (1 - ew)),
    loserDelta: Math.round(kFactor(loser.rating, loser.gamesPlayed) * (0 - el)),
  };
}
