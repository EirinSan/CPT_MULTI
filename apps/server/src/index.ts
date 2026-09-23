import Fastify from "fastify";
import { createPrismaClient } from "@cpt/db";
import { challengeRoutes } from "./routes/challenges";
import { leaderboardRoutes } from "./routes/leaderboards";

const app = Fastify({ logger: true });
const prisma = createPrismaClient();

app.decorate("prisma", prisma);
app.addHook("onClose", async () => prisma.$disconnect());

app.get("/health", async () => ({ ok: true }));
await app.register(challengeRoutes, { prefix: "/challenges" });
await app.register(leaderboardRoutes, { prefix: "/leaderboards" });

const port = Number(process.env.PORT ?? 3001);
await app.listen({ port, host: "0.0.0.0" });
