import type { ClientToServerEvents, ServerToClientEvents } from "@cpt/shared";
import { io, type Socket } from "socket.io-client";

export type RankedSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export function connectRanked(token: string): RankedSocket {
  return io({ path: "/socket.io", auth: { token }, transports: ["websocket"] });
}
