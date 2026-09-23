import type { FastifyPluginAsync } from "fastify";

export const challengeRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", async () =>
    app.prisma.challenge.findMany({
      where: { isPublished: true },
      select: { id: true, slug: true, title: true, difficulty: true, category: true, modes: true, timeLimit: true },
      orderBy: { createdAt: "desc" },
    }),
  );

  app.get<{ Params: { slug: string } }>("/:slug", async (req, reply) => {
    const challenge = await app.prisma.challenge.findUnique({ where: { slug: req.params.slug } });
    if (!challenge || !challenge.isPublished) return reply.code(404).send({ error: "not_found" });
    // Assertions stay server-side: the client must not know the expected answer.
    const { targetStateAssertions: _hidden, ...publicFields } = challenge;
    return publicFields;
  });
};
