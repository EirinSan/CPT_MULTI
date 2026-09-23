/**
 * Socket.io wiring for ranked 1v1: queue, match lifecycle, persistence and
 * ELO updates. Game rules live in MatchRoom / matchmaking (pure modules).
 */
import type { PrismaClient } from "@cpt/db";
import {
  eloDelta,
  rankInfo,
  tierForRating,
  type ClientToServerEvents,
  type MatchEnd,
  type ServerToClientEvents,
} from "@cpt/shared";
import type { FastifyInstance } from "fastify";
import type { Server, Socket } from "socket.io";
import type { TokenPayload } from "../plugins/auth";
import { toRecord } from "../services/missions";
import { toPublicUser } from "../services/users";
import { MatchRoom, type RoomPlayer } from "./match-room";
import { findPairs, type QueueEntry } from "./matchmaking";

interface SocketData {
  userId: string;
  username: string;
}

export type RankedIO = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
type RankedSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

const RECONNECT_GRACE_MS = 20_000;
const userRoom = (userId: string) => `user:${userId}`;

export class RankedService {
  private readonly queue = new Map<string, QueueEntry>();
  private readonly rooms = new Map<string, MatchRoom>();
  private readonly roomByUser = new Map<string, string>();
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private ticker: NodeJS.Timeout | null = null;
  private readonly prisma: PrismaClient;

  constructor(
    private readonly app: FastifyInstance,
    private readonly io: RankedIO,
    private readonly now: () => number = Date.now,
  ) {
    this.prisma = app.prisma;
  }

  start(): void {
    this.io.use((socket, next) => {
      const token = (socket.handshake.auth as { token?: unknown }).token;
      try {
        if (typeof token !== "string") throw new Error("missing token");
        const payload = this.app.jwt.verify<TokenPayload>(token);
        socket.data.userId = payload.sub;
        socket.data.username = payload.username;
        next();
      } catch {
        next(new Error("unauthorized"));
      }
    });
    this.io.on("connection", (socket) => this.onConnection(socket));
    this.ticker = setInterval(() => void this.tick(), 1000);
  }

  stop(): void {
    if (this.ticker) clearInterval(this.ticker);
    for (const t of this.timers.values()) clearTimeout(t);
  }

  // -------------------------------------------------------------------------

  private onConnection(socket: RankedSocket): void {
    const { userId } = socket.data;
    void socket.join(userRoom(userId));
    this.clearTimer(`dc:${userId}`);

    const active = this.activeRoom(userId);
    if (active) this.sendMatchFound(active, userId, true);

    socket.on("queue:join", () => void this.joinQueue(socket));
    socket.on("queue:leave", () => {
      this.queue.delete(userId);
      socket.emit("queue:status", this.queueStatus(userId));
    });
    socket.on("match:command", (payload) => {
      const room = this.rooms.get(payload?.matchId);
      if (!room || !room.player(userId)) return;
      if (!room.applyCommand(userId, payload.deviceId, payload.line, this.now())) return;
      this.emitProgress(room);
      if (room.outcome) void this.finish(room);
    });
    socket.on("match:forfeit", (payload) => {
      const room = this.rooms.get(payload?.matchId);
      if (!room || !room.player(userId)) return;
      room.forfeit(userId, "forfeit");
      void this.finish(room);
    });
    socket.on("disconnect", () => void this.onDisconnect(userId));
  }

  private async onDisconnect(userId: string): Promise<void> {
    const remaining = await this.io.in(userRoom(userId)).fetchSockets();
    if (remaining.length > 0) return;
    this.queue.delete(userId);
    const room = this.activeRoom(userId);
    if (!room) return;
    this.setTimer(`dc:${userId}`, RECONNECT_GRACE_MS, () => {
      if (room.outcome) return;
      room.forfeit(userId, "disconnect");
      void this.finish(room);
    });
  }

  private async joinQueue(socket: RankedSocket): Promise<void> {
    const { userId } = socket.data;
    if (this.activeRoom(userId)) {
      socket.emit("error:message", "Tu es déjà en match.");
      return;
    }
    if (!this.queue.has(userId)) {
      const user = await this.prisma.user.findUnique({ where: { id: userId }, include: { stats: true } });
      if (!user) return;
      this.queue.set(userId, {
        userId,
        username: user.username,
        elo: user.elo,
        gamesPlayed: user.stats?.matchesPlayed ?? 0,
        joinedAt: this.now(),
      });
    }
    socket.emit("queue:status", this.queueStatus(userId));
  }

  private queueStatus(userId: string) {
    const entry = this.queue.get(userId);
    return {
      inQueue: !!entry,
      playersInQueue: this.queue.size,
      waitingSec: entry ? Math.floor((this.now() - entry.joinedAt) / 1000) : 0,
    };
  }

  private async tick(): Promise<void> {
    const pairs = findPairs([...this.queue.values()], this.now());
    for (const [a, b] of pairs) {
      this.queue.delete(a.userId);
      this.queue.delete(b.userId);
      try {
        await this.startMatch(a, b);
      } catch (err) {
        this.app.log.error(err, "failed to start match");
        for (const e of [a, b]) this.io.to(userRoom(e.userId)).emit("error:message", "Impossible de lancer le match.");
      }
    }
    for (const userId of this.queue.keys()) {
      this.io.to(userRoom(userId)).emit("queue:status", this.queueStatus(userId));
    }
  }

  private async startMatch(a: QueueEntry, b: QueueEntry): Promise<void> {
    const pool = await this.prisma.challenge.findMany({ where: { isPublished: true, modes: { has: "RANKED_1V1" } } });
    if (pool.length === 0) throw new Error("no ranked missions published");
    const challenge = pool[Math.floor(Math.random() * pool.length)]!;
    const mission = toRecord(challenge);
    const startedAt = this.now();

    const match = await this.prisma.match.create({
      data: {
        mode: "RANKED_1V1",
        ranked: true,
        status: "IN_PROGRESS",
        challengeId: mission.id,
        challengeVersion: mission.version,
        startAt: new Date(startedAt),
        players: { create: [a, b].map((e) => ({ userId: e.userId, eloBefore: e.elo })) },
      },
    });

    const room = new MatchRoom(match.id, mission, [a, b], startedAt);
    this.rooms.set(room.id, room);
    for (const e of [a, b]) this.roomByUser.set(e.userId, room.id);
    this.setTimer(`room:${room.id}`, room.endsAt - startedAt, () => {
      room.timeout();
      void this.finish(room);
    });
    for (const e of [a, b]) this.sendMatchFound(room, e.userId, false);
    this.emitProgress(room);
  }

  private sendMatchFound(room: MatchRoom, userId: string, resume: boolean): void {
    const me = room.player(userId)!;
    const opp = room.opponent(userId)!;
    this.io.to(userRoom(userId)).emit("match:found", {
      matchId: room.id,
      mission: room.mission.detail,
      opponent: { username: opp.entry.username, elo: opp.entry.elo, rankLabel: rankInfo(opp.entry.elo).label },
      startedAt: room.startedAt,
      endsAt: room.endsAt,
      ...(resume ? { replay: me.commands } : {}),
    });
    if (resume) this.emitProgress(room);
  }

  private emitProgress(room: MatchRoom): void {
    const total = room.mission.assertions.all.length;
    for (const p of room.players) {
      const opp = room.opponent(p.entry.userId)!;
      this.io.to(userRoom(p.entry.userId)).emit("match:progress", {
        matchId: room.id,
        results: p.results,
        opponentPassed: MatchRoom.passed(opp),
        total,
      });
    }
  }

  private activeRoom(userId: string): MatchRoom | undefined {
    const id = this.roomByUser.get(userId);
    const room = id ? this.rooms.get(id) : undefined;
    return room && !room.outcome ? room : undefined;
  }

  private async finish(room: MatchRoom): Promise<void> {
    if (!this.rooms.delete(room.id)) return; // already finishing
    this.clearTimer(`room:${room.id}`);
    const outcome = room.outcome ?? room.timeout();
    const endedAt = this.now();

    const ends = new Map<string, MatchEnd>();
    await this.prisma.$transaction(async (tx) => {
      await tx.match.update({
        where: { id: room.id },
        data: { status: "COMPLETED", winnerId: outcome.winnerId, endedAt: new Date(endedAt) },
      });
      for (const p of room.players) {
        const opp = room.opponent(p.entry.userId)!;
        const score = outcome.winnerId === null ? 0.5 : outcome.winnerId === p.entry.userId ? 1 : 0;
        const result = score === 1 ? "WIN" : score === 0.5 ? "DRAW" : "LOSS";
        const delta = eloDelta({ rating: p.entry.elo, gamesPlayed: p.entry.gamesPlayed }, { rating: opp.entry.elo }, score);
        const eloAfter = Math.max(0, p.entry.elo + delta);
        const timeMs = p.solvedAt === null ? null : p.solvedAt - room.startedAt;

        await tx.matchParticipant.update({
          where: { matchId_userId: { matchId: room.id, userId: p.entry.userId } },
          data: {
            result,
            eloAfter,
            eloDelta: eloAfter - p.entry.elo,
            completionTimeMs: timeMs,
            commandCount: p.commands.length,
            syntaxErrorCount: syntaxErrors(p),
            finalState: { commands: p.commands as unknown as object[] },
          },
        });
        const current = await tx.user.findUniqueOrThrow({ where: { id: p.entry.userId }, include: { stats: true } });
        const streak = result === "WIN" ? (current.stats?.currentStreak ?? 0) + 1 : 0;
        const user = await tx.user.update({
          where: { id: p.entry.userId },
          data: { elo: eloAfter, peakElo: Math.max(current.peakElo, eloAfter), rankTier: tierForRating(eloAfter) },
        });
        const playSec = Math.round((endedAt - room.startedAt) / 1000);
        await tx.userStats.upsert({
          where: { userId: p.entry.userId },
          create: {
            userId: p.entry.userId,
            matchesPlayed: 1,
            wins: result === "WIN" ? 1 : 0,
            losses: result === "LOSS" ? 1 : 0,
            draws: result === "DRAW" ? 1 : 0,
            currentStreak: streak,
            bestStreak: streak,
            totalPlayTimeSec: playSec,
            commandsTyped: p.commands.length,
            syntaxErrors: syntaxErrors(p),
          },
          update: {
            matchesPlayed: { increment: 1 },
            wins: { increment: result === "WIN" ? 1 : 0 },
            losses: { increment: result === "LOSS" ? 1 : 0 },
            draws: { increment: result === "DRAW" ? 1 : 0 },
            currentStreak: streak,
            bestStreak: Math.max(current.stats?.bestStreak ?? 0, streak),
            totalPlayTimeSec: { increment: playSec },
            commandsTyped: { increment: p.commands.length },
            syntaxErrors: { increment: syntaxErrors(p) },
          },
        });
        ends.set(p.entry.userId, {
          matchId: room.id,
          outcome: score === 1 ? "win" : score === 0.5 ? "draw" : "loss",
          reason: outcome.reason,
          eloBefore: p.entry.elo,
          eloAfter,
          eloDelta: eloAfter - p.entry.elo,
          timeMs,
          user: toPublicUser(user),
        });
      }
    });

    for (const p of room.players) {
      this.roomByUser.delete(p.entry.userId);
      this.clearTimer(`dc:${p.entry.userId}`);
      this.io.to(userRoom(p.entry.userId)).emit("match:end", ends.get(p.entry.userId)!);
    }
  }

  private setTimer(key: string, ms: number, fn: () => void): void {
    this.clearTimer(key);
    this.timers.set(
      key,
      setTimeout(() => {
        this.timers.delete(key);
        fn();
      }, Math.max(0, ms)),
    );
  }

  private clearTimer(key: string): void {
    const t = this.timers.get(key);
    if (t) clearTimeout(t);
    this.timers.delete(key);
  }
}

function syntaxErrors(p: RoomPlayer): number {
  let n = 0;
  for (const node of p.lab.nodes.values()) n += node.session?.syntaxErrors ?? 0;
  return n;
}
