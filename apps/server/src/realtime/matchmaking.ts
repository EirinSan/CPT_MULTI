/** Pure matchmaking logic: who plays whom. */

export interface QueueEntry {
  userId: string;
  username: string;
  elo: number;
  gamesPlayed: number;
  /** Epoch ms. */
  joinedAt: number;
}

/** Allowed ELO gap grows with waiting time so nobody waits forever. */
export function eloWindow(waitMs: number): number {
  return Math.min(100 + 25 * Math.floor(waitMs / 1000), 1000);
}

/**
 * Greedy pairing, longest-waiting players first, each with the closest
 * opponent inside the widest of the two players' windows.
 */
export function findPairs(queue: QueueEntry[], now: number): Array<[QueueEntry, QueueEntry]> {
  const waiting = [...queue].sort((a, b) => a.joinedAt - b.joinedAt);
  const taken = new Set<string>();
  const pairs: Array<[QueueEntry, QueueEntry]> = [];
  for (const a of waiting) {
    if (taken.has(a.userId)) continue;
    let best: QueueEntry | null = null;
    for (const b of waiting) {
      if (b.userId === a.userId || taken.has(b.userId)) continue;
      const gap = Math.abs(a.elo - b.elo);
      const window = Math.max(eloWindow(now - a.joinedAt), eloWindow(now - b.joinedAt));
      if (gap > window) continue;
      if (!best || gap < Math.abs(a.elo - best.elo)) best = b;
    }
    if (best) {
      taken.add(a.userId);
      taken.add(best.userId);
      pairs.push([a, best]);
    }
  }
  return pairs;
}
