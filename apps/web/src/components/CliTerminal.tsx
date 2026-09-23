import { LineDiscipline, type CliSession } from "@cpt/cli-engine";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useEffect, useRef } from "react";

interface Props {
  session: CliSession;
  /** Shown in the console banner. */
  banner: string;
  active: boolean;
  /** Read-only console (match over). */
  locked?: boolean;
  /** Route execution elsewhere (a Lab), defaults to session.execute. */
  execute?: (line: string) => string[];
  onExecute?: (line: string, output: string[]) => void;
  /** Receives the line discipline so async syslog can be printed. */
  onReady?: (ld: LineDiscipline) => () => void;
}

/** xterm.js console bound to one device's CLI session. */
export function CliTerminal({ session, banner, active, locked = false, execute, onExecute, onReady }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const fit = useRef<FitAddon | null>(null);
  const term = useRef<Terminal | null>(null);
  // Latest callbacks, so the terminal is created once per session.
  const latest = useRef({ execute, onExecute, onReady });
  latest.current = { execute, onExecute, onReady };

  useEffect(() => {
    const t = new Terminal({
      cursorBlink: true,
      fontFamily: '"JetBrains Mono", "Fira Code", Menlo, Consolas, "DejaVu Sans Mono", monospace',
      lineHeight: 1.15,
      fontSize: 14,
      scrollback: 5000,
      theme: {
        background: "#0b0f14",
        foreground: "#d6dee8",
        cursor: "#22d3ee",
        selectionBackground: "#22d3ee55",
      },
    });
    const f = new FitAddon();
    t.loadAddon(f);
    t.open(host.current!);
    f.fit();

    const ld = new LineDiscipline(session, {
      write: (data) => t.write(data),
      execute: (line) => (latest.current.execute ? latest.current.execute(line) : session.execute(line)),
      onExecute: (line, output) => latest.current.onExecute?.(line, output),
    });
    const input = t.onData((data) => ld.input(data));
    const release = latest.current.onReady?.(ld);
    t.writeln(`\x1b[2m${banner}\x1b[0m`);
    t.write("\r\nPress RETURN to get started.\r\n");
    ld.start();

    term.current = t;
    fit.current = f;
    const observer = new ResizeObserver(() => {
      if (host.current?.offsetParent) f.fit();
    });
    observer.observe(host.current!);
    return () => {
      observer.disconnect();
      input.dispose();
      release?.();
      t.dispose();
    };
    // `banner` is cosmetic; recreate only for a new session.
  }, [session]);

  useEffect(() => {
    if (term.current) term.current.options.disableStdin = locked;
  }, [locked]);

  useEffect(() => {
    if (!active) return;
    fit.current?.fit();
    term.current?.focus();
  }, [active]);

  return <div ref={host} className={active ? "h-full w-full" : "hidden"} />;
}
