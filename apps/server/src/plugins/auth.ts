import fastifyJwt from "@fastify/jwt";
import type { FastifyReply, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import { config } from "../config";

export interface TokenPayload {
  sub: string;
  username: string;
}

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: TokenPayload;
    user: TokenPayload;
  }
}

declare module "fastify" {
  interface FastifyInstance {
    /** preHandler: 401 unless a valid bearer token is present. */
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    /** Returns the user id if a valid token is present, without failing. */
    optionalUserId: (req: FastifyRequest) => Promise<string | null>;
  }
}

export const authPlugin = fp(async (app) => {
  await app.register(fastifyJwt, { secret: config.jwtSecret, sign: { expiresIn: "30d" } });

  app.decorate("authenticate", async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      await req.jwtVerify();
    } catch {
      await reply.code(401).send({ error: "unauthorized" });
    }
  });

  app.decorate("optionalUserId", async (req: FastifyRequest) => {
    if (!req.headers.authorization) return null;
    try {
      const payload = await req.jwtVerify<TokenPayload>();
      return payload.sub;
    } catch {
      return null;
    }
  });
});
