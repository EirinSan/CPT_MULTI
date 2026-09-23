import { useEffect, useState } from "react";

export interface AsyncState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
}

/** Runs `fn` whenever `deps` change; ignores stale responses. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): AsyncState<T> & { reload: () => void } {
  const [state, setState] = useState<AsyncState<T>>({ data: null, error: null, loading: true });
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    fn().then(
      (data) => alive && setState({ data, error: null, loading: false }),
      (e: unknown) => alive && setState({ data: null, error: e instanceof Error ? e.message : String(e), loading: false }),
    );
    return () => {
      alive = false;
    };
  }, [...deps, nonce]);
  return { ...state, reload: () => setNonce((n) => n + 1) };
}

/** Milliseconds elapsed since `start` (or remaining until `end`), ticking. */
export function useNow(intervalMs = 250): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function formatTime(ms: number): string {
  const s = ms / 1000;
  return s < 60 ? `${s.toFixed(1)} s` : formatDuration(ms);
}
