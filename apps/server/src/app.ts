import type { PrismaClient } from "@cpt/db";
import Fastify, { type FastifyInstance } from "fastify";
import { authPlugin } from "./plugins/auth";
import { authRoutes } from "./routes/auth";
import { leaderboardRoutes } from "./routes/leaderboards";
import { meRoutes } from "./routes/me";
import { missionRoutes } from "./routes/missions";

export async function buildApp(prisma: PrismaClient, opts: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? true, bodyLimit: 512 * 1024 });
  app.decorate("prisma", prisma);
  await app.register(authPlugin);

  await app.register(
    async (api) => {
      api.get("/health", async () => ({ ok: true }));
      await api.register(authRoutes, { prefix: "/auth" });
      await api.register(meRoutes, { prefix: "/me" });
      await api.register(missionRoutes, { prefix: "/missions" });
      await api.register(leaderboardRoutes, { prefix: "/leaderboards" });
    },
    { prefix: "/api" },
  );
  return app;
}
