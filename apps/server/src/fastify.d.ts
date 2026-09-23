import type { PrismaClient } from "@cpt/db";

declare module "fastify" {
  interface FastifyInstance {
    prisma: PrismaClient;
  }
}
