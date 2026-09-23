import { rankInfo, type LeaderboardRow } from "@cpt/shared";
import type { FastifyPluginAsync } from "fastify";

export const leaderboardRoutes: FastifyPluginAsync = async (app) => {
  // Live ranking by ELO. The materialised Leaderboard tables will take over
  // once seasons exist.
  app.get<{ Querystring: { limit?: string } }>("/ranked", async (req) => {
    const limit = Math.min(Number(req.query.limit ?? 50) || 50, 200);
    const users = await app.prisma.user.findMany({
      where: { stats: { matchesPlayed: { gt: 0 } } },
      orderBy: [{ elo: "desc" }, { createdAt: "asc" }],
      take: limit,
      include: { stats: true },
    });
    return users.map(
      (u, i): LeaderboardRow => ({
        rank: i + 1,
        username: u.username,
        elo: u.elo,
        rankLabel: rankInfo(u.elo).label,
        wins: u.stats?.wins ?? 0,
        losses: u.stats?.losses ?? 0,
      }),
    );
  });
};
