import type { MatchHistoryItem, ProfileResponse } from "@cpt/shared";
import type { FastifyPluginAsync } from "fastify";
import { toPublicUser, toStatsDto } from "../services/users";

export const meRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", { preHandler: app.authenticate }, async (req, reply) => {
    const user = await app.prisma.user.findUnique({ where: { id: req.user.sub }, include: { stats: true } });
    if (!user) return reply.code(401).send({ error: "unauthorized" });

    const participations = await app.prisma.matchParticipant.findMany({
      where: { userId: user.id, match: { status: { in: ["COMPLETED", "ABORTED"] } } },
      orderBy: { joinedAt: "desc" },
      take: 15,
      include: {
        match: {
          include: {
            challenge: { select: { title: true, slug: true } },
            players: { include: { user: { select: { username: true } } } },
          },
        },
      },
    });

    const recentMatches: MatchHistoryItem[] = participations.map((p) => ({
      id: p.matchId,
      mode: p.match.mode,
      missionTitle: p.match.challenge.title,
      missionSlug: p.match.challenge.slug,
      result: p.result,
      eloDelta: p.match.ranked ? p.eloDelta : null,
      completionTimeMs: p.completionTimeMs,
      opponent: p.match.players.find((o) => o.userId !== user.id)?.user.username ?? null,
      endedAt: p.match.endedAt?.toISOString() ?? null,
    }));

    return { user: toPublicUser(user), stats: toStatsDto(user.stats), recentMatches } satisfies ProfileResponse;
  });
};
