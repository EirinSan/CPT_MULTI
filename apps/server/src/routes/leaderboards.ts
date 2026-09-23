import type { FastifyPluginAsync } from "fastify";
import { rankInfo } from "@cpt/shared";

export const leaderboardRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { key: string }; Querystring: { limit?: string } }>("/:key", async (req, reply) => {
    const limit = Math.min(Number(req.query.limit ?? 50) || 50, 200);
    const board = await app.prisma.leaderboard.findUnique({
      where: { key: req.params.key },
      include: {
        entries: {
          orderBy: { rank: "asc" },
          take: limit,
          include: { user: { select: { username: true, avatarUrl: true } } },
        },
      },
    });
    if (!board) return reply.code(404).send({ error: "not_found" });
    return {
      key: board.key,
      mode: board.mode,
      scope: board.scope,
      updatedAt: board.updatedAt,
      entries: board.entries.map((e) => ({
        rank: e.rank,
        username: e.user.username,
        avatarUrl: e.user.avatarUrl,
        score: e.score,
        bestTimeMs: e.bestTimeMs,
        wins: e.wins,
        losses: e.losses,
        division: board.scope === "CHALLENGE" ? null : rankInfo(e.score).label,
      })),
    };
  });
};
