import { LineDiscipline } from "@cpt/cli-engine";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useEffect, useRef } from "react";
import { registerConsole, useLab, type LabDevice } from "../store/lab";

interface Props {
  device: LabDevice;
  active: boolean;
}

/** xterm.js console bound to one device's CLI session. */
export function CliTerminal({ device, active }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const fit = useRef<FitAddon | null>(null);
  const term = useRef<Terminal | null>(null);
  const bump = useLab((s) => s.bump);

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

    const ld = new LineDiscipline(device.session, {
      write: (data) => t.write(data),
      onExecute: () => bump(),
    });
    const input = t.onData((data) => ld.input(data));
    const unregister = registerConsole(device.id, ld);
    t.writeln(`\x1b[2m${device.label} ${device.session.device.model} — console 9600 8N1\x1b[0m`);
    t.write("\r\nPress RETURN to get started.\r\n");
    ld.start();

    term.current = t;
    fit.current = f;
    const onResize = () => f.fit();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      input.dispose();
      unregister();
      t.dispose();
    };
  }, [device, bump]);

  useEffect(() => {
    if (!active) return;
    fit.current?.fit();
    term.current?.focus();
  }, [active]);

  return <div ref={host} className={active ? "h-full w-full" : "hidden"} />;
}
