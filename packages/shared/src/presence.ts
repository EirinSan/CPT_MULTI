/**
 * Payload sent from the web client to the desktop shell (Tauri) which
 * forwards it to Discord's local IPC as a Rich Presence activity.
 */
export interface PresencePayload {
  mode: "lobby" | "ranked-1v1" | "speedrun" | "ctf" | "sandbox";
  /** Line 1, e.g. "Ranked 1v1 - Gold II". */
  details: string;
  /** Line 2, e.g. "OSPF multi-area - 3/5 checks". */
  state?: string;
  /** Epoch ms; Discord shows elapsed time from this. */
  startedAt?: number;
  /** Epoch ms; Discord shows a countdown to this (time-limited challenges). */
  endsAt?: number;
  /** Asset keys configured in the Discord Developer Portal. */
  largeImageKey?: string;
  smallImageKey?: string;
  smallImageText?: string;
}
