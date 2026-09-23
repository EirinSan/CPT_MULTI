import type { AttemptResponse, EvaluateResponse, MissionLeaderboardRow, MissionSummary } from "@cpt/shared";
import type { FastifyPluginAsync } from "fastify";
import { InvalidCommandLog, findMission, parseCommandLog, replay, toSummary } from "../services/missions";

interface CommandsBody {
  commands?: unknown;
  durationMs?: unknown;
}

export const missionRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", async (req) => {
    const userId = await app.optionalUserId(req);
    const challenges = await app.prisma.challenge.findMany({
      where: { isPublished: true },
      orderBy: [{ difficulty: "asc" }, { parTimeSec: "asc" }],
    });
    const best = new Map<string, number>();
    if (userId) {
      const wins = await app.prisma.matchParticipant.findMany({
        where: { userId, result: "WIN", completionTimeMs: { not: null }, match: { mode: "SPEEDRUN" } },
        select: { completionTimeMs: true, match: { select: { challengeId: true } } },
      });
      for (const w of wins) {
        const prev = best.get(w.match.challengeId);
        if (prev === undefined || w.completionTimeMs! < prev) best.set(w.match.challengeId, w.completionTimeMs!);
      }
    }
    return challenges.map(
      (c): MissionSummary => ({ ...toSummary(c), ...(userId ? { bestTimeMs: best.get(c.id) ?? null } : {}) }),
    );
  });

  app.get<{ Params: { slug: string } }>("/:slug", async (req, reply) => {
    const mission = await findMission(app.prisma, req.params.slug);
    if (!mission) return reply.code(404).send({ error: "Mission introuvable." });
    return mission.detail;
  });

  // Live objective checklist during a solo run. Stateless: replays the log.
  app.post<{ Params: { slug: string }; Body: CommandsBody }>("/:slug/evaluate", async (req, reply) => {
    const mission = await findMission(app.prisma, req.params.slug);
    if (!mission) return reply.code(404).send({ error: "Mission introuvable." });
    try {
      const { results, solved } = replay(mission, parseCommandLog(req.body?.commands, mission.detail.topology));
      return { results, solved } satisfies EvaluateResponse;
    } catch (e) {
      if (e instanceof InvalidCommandLog) return reply.code(400).send({ error: e.message });
      throw e;
    }
  });

  // Records a solved solo run (speedrun). Re-validated server-side.
  app.post<{ Params: { slug: string }; Body: CommandsBody }>(
    "/:slug/attempts",
    { preHandler: app.authenticate },
    async (req, reply) => {
      const mission = await findMission(app.prisma, req.params.slug);
      if (!mission) return reply.code(404).send({ error: "Mission introuvable." });
      let commands;
      try {
        commands = parseCommandLog(req.body?.commands, mission.detail.topology);
      } catch (e) {
        if (e instanceof InvalidCommandLog) return reply.code(400).send({ error: e.message });
        throw e;
      }
      const result = replay(mission, commands);
      if (!result.solved) return reply.code(422).send({ error: "Mission non résolue.", results: result.results });

      const reported = typeof req.body?.durationMs === "number" ? req.body.durationMs : 0;
      const lastCommandAt = commands.at(-1)?.t ?? 0;
      const timeMs = Math.round(Math.min(Math.max(reported, lastCommandAt), mission.detail.timeLimit * 1000));
      const userId = req.user.sub;

      const previousBest = await app.prisma.matchParticipant.findFirst({
        where: { userId, result: "WIN", match: { challengeId: mission.id, mode: "SPEEDRUN" } },
        orderBy: { completionTimeMs: "asc" },
        select: { completionTimeMs: true },
      });
      const user = await app.prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { stats: true } });
      const fastest = user.stats?.fastestSolveMs;
      const now = new Date();

      await app.prisma.$transaction([
        app.prisma.match.create({
          data: {
            mode: "SPEEDRUN",
            ranked: false,
            status: "COMPLETED",
            challengeId: mission.id,
            challengeVersion: mission.version,
            winnerId: userId,
            startAt: new Date(now.getTime() - timeMs),
            endedAt: now,
            players: {
              create: {
                userId,
                result: "WIN",
                eloBefore: user.elo,
                eloAfter: user.elo,
                eloDelta: 0,
                completionTimeMs: timeMs,
                commandCount: commands.length,
                syntaxErrorCount: result.syntaxErrors,
                finalState: { commands: commands as unknown as object[] },
              },
            },
          },
        }),
        app.prisma.userStats.upsert({
          where: { userId },
          create: { userId, challengesSolved: 1, fastestSolveMs: timeMs, commandsTyped: commands.length },
          update: {
            challengesSolved: previousBest ? undefined : { increment: 1 },
            commandsTyped: { increment: commands.length },
            syntaxErrors: { increment: result.syntaxErrors },
            fastestSolveMs: fastest == null || timeMs < fastest ? timeMs : undefined,
          },
        }),
      ]);

      const prev = previousBest?.completionTimeMs ?? null;
      return {
        results: result.results,
        solved: true,
        timeMs,
        bestTimeMs: prev === null ? timeMs : Math.min(prev, timeMs),
        personalBest: prev === null || timeMs < prev,
      } satisfies AttemptResponse;
    },
  );

  app.get<{ Params: { slug: string } }>("/:slug/leaderboard", async (req, reply) => {
    const mission = await findMission(app.prisma, req.params.slug);
    if (!mission) return reply.code(404).send({ error: "Mission introuvable." });
    const rows = await app.prisma.matchParticipant.findMany({
      where: { result: "WIN", completionTimeMs: { not: null }, match: { challengeId: mission.id, mode: "SPEEDRUN" } },
      orderBy: { completionTimeMs: "asc" },
      take: 200,
      include: { user: { select: { username: true } }, match: { select: { endedAt: true } } },
    });
    const seen = new Set<string>();
    const board: MissionLeaderboardRow[] = [];
    for (const r of rows) {
      if (seen.has(r.userId)) continue;
      seen.add(r.userId);
      board.push({
        rank: board.length + 1,
        username: r.user.username,
        timeMs: r.completionTimeMs!,
        achievedAt: (r.match.endedAt ?? r.joinedAt).toISOString(),
      });
      if (board.length === 20) break;
    }
    return board;
  });
};
