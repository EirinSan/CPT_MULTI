import type { AuthResponse } from "@cpt/shared";
import type { FastifyPluginAsync } from "fastify";
import { hashPassword, verifyPassword } from "../auth/password";
import { toPublicUser } from "../services/users";

const USERNAME = /^[a-zA-Z0-9_-]{3,20}$/;

interface Credentials {
  username?: unknown;
  password?: unknown;
}

function readCredentials(body: Credentials | undefined): { username: string; password: string } | null {
  if (typeof body?.username !== "string" || typeof body.password !== "string") return null;
  return { username: body.username.trim(), password: body.password };
}

export const authRoutes: FastifyPluginAsync = async (app) => {
  app.post<{ Body: Credentials }>("/register", async (req, reply) => {
    const creds = readCredentials(req.body);
    if (!creds) return reply.code(400).send({ error: "Pseudo et mot de passe requis." });
    if (!USERNAME.test(creds.username)) {
      return reply.code(400).send({ error: "Pseudo : 3 à 20 caractères (lettres, chiffres, _ ou -)." });
    }
    if (creds.password.length < 8 || creds.password.length > 128) {
      return reply.code(400).send({ error: "Le mot de passe doit faire au moins 8 caractères." });
    }
    const taken = await app.prisma.user.findFirst({
      where: { username: { equals: creds.username, mode: "insensitive" } },
      select: { id: true },
    });
    if (taken) return reply.code(409).send({ error: "Ce pseudo est déjà pris." });

    const user = await app.prisma.user.create({
      data: { username: creds.username, passwordHash: await hashPassword(creds.password), stats: { create: {} } },
    });
    const token = app.jwt.sign({ sub: user.id, username: user.username });
    return reply.code(201).send({ token, user: toPublicUser(user) } satisfies AuthResponse);
  });

  app.post<{ Body: Credentials }>("/login", async (req, reply) => {
    const creds = readCredentials(req.body);
    if (!creds) return reply.code(400).send({ error: "Pseudo et mot de passe requis." });
    const user = await app.prisma.user.findFirst({
      where: { username: { equals: creds.username, mode: "insensitive" } },
    });
    if (!user?.passwordHash || !(await verifyPassword(creds.password, user.passwordHash))) {
      return reply.code(401).send({ error: "Pseudo ou mot de passe incorrect." });
    }
    const token = app.jwt.sign({ sub: user.id, username: user.username });
    return { token, user: toPublicUser(user) } satisfies AuthResponse;
  });
};
