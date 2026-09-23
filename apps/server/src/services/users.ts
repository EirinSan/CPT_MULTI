import type { PrismaClient, User, UserStats } from "@cpt/db";
import { rankInfo, type PublicUser, type UserStatsDto } from "@cpt/shared";

export function toPublicUser(u: User): PublicUser {
  return {
    id: u.id,
    username: u.username,
    elo: u.elo,
    peakElo: u.peakElo,
    rankTier: u.rankTier,
    rankLabel: rankInfo(u.elo).label,
    createdAt: u.createdAt.toISOString(),
  };
}

export function toStatsDto(s: UserStats | null): UserStatsDto {
  return {
    matchesPlayed: s?.matchesPlayed ?? 0,
    wins: s?.wins ?? 0,
    losses: s?.losses ?? 0,
    draws: s?.draws ?? 0,
    currentStreak: s?.currentStreak ?? 0,
    bestStreak: s?.bestStreak ?? 0,
    challengesSolved: s?.challengesSolved ?? 0,
    fastestSolveMs: s?.fastestSolveMs ?? null,
  };
}

export async function getUser(prisma: PrismaClient, id: string): Promise<User | null> {
  return prisma.user.findUnique({ where: { id } });
}
