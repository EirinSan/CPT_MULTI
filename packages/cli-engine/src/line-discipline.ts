/**
 * Line editing for an IOS-like console, independent of the terminal widget.
 * Feed it raw input (xterm.js `onData`) and it writes ANSI output back.
 *
 * Supported keys: printable chars, Backspace/Delete, Left/Right, Home/End,
 * Up/Down and Ctrl+P/Ctrl+N (history), Tab (completion), `?` (help),
 * Ctrl+A/Ctrl+E, Ctrl+U (kill line), Ctrl+C (abort line), Ctrl+Z (end).
 */
import type { CliSession } from "./session";

const ESCAPE_SEQUENCE = /^\x1b(?:\[[0-9;]*[A-Za-z~]|O[A-Za-z])/;

export interface LineDisciplineOptions {
  write: (data: string) => void;
  /** Called after each executed command (mode may have changed). */
  onExecute?: (line: string, output: string[]) => void;
}

export class LineDiscipline {
  private buffer = "";
  private cursor = 0;
  /** Index into session.history while browsing; null = editing a new line. */
  private historyIndex: number | null = null;
  private draft = "";

  constructor(
    private readonly session: CliSession,
    private readonly opts: LineDisciplineOptions,
  ) {}

  start(): void {
    this.opts.write(`\r\n${this.session.prompt}`);
  }

  /** Print asynchronous output (syslog) without losing the line being typed. */
  printAsync(lines: string[]): void {
    if (lines.length === 0) return;
    this.opts.write(`\r\x1b[K${lines.join("\r\n")}\r\n`);
    this.redraw();
  }

  input(data: string): void {
    let i = 0;
    while (i < data.length) {
      const rest = data.slice(i);
      const esc = ESCAPE_SEQUENCE.exec(rest);
      if (esc) {
        this.escape(esc[0]);
        i += esc[0].length;
        continue;
      }
      this.key(data[i]!);
      i++;
    }
  }

  private escape(seq: string): void {
    switch (seq) {
      case "\x1b[A":
      case "\x1bOA":
        return this.historyPrev();
      case "\x1b[B":
      case "\x1bOB":
        return this.historyNext();
      case "\x1b[C":
      case "\x1bOC":
        if (this.cursor < this.buffer.length) {
          this.cursor++;
          this.opts.write("\x1b[C");
        }
        return;
      case "\x1b[D":
      case "\x1bOD":
        if (this.cursor > 0) {
          this.cursor--;
          this.opts.write("\x1b[D");
        }
        return;
      case "\x1b[H":
      case "\x1bOH":
      case "\x1b[1~":
        this.cursor = 0;
        return this.redraw();
      case "\x1b[F":
      case "\x1bOF":
      case "\x1b[4~":
        this.cursor = this.buffer.length;
        return this.redraw();
      case "\x1b[3~":
        if (this.cursor < this.buffer.length) {
          this.buffer = this.buffer.slice(0, this.cursor) + this.buffer.slice(this.cursor + 1);
          this.redraw();
        }
        return;
    }
  }

  private key(ch: string): void {
    switch (ch) {
      case "\r":
      case "\n":
        return this.enter();
      case "\x7f":
      case "\b":
        if (this.cursor > 0) {
          this.buffer = this.buffer.slice(0, this.cursor - 1) + this.buffer.slice(this.cursor);
          this.cursor--;
          this.redraw();
        }
        return;
      case "\t":
        return this.tab();
      case "?":
        return this.help();
      case "\x01": // Ctrl+A
        this.cursor = 0;
        return this.redraw();
      case "\x05": // Ctrl+E
        this.cursor = this.buffer.length;
        return this.redraw();
      case "\x10": // Ctrl+P
        return this.historyPrev();
      case "\x0e": // Ctrl+N
        return this.historyNext();
      case "\x15": // Ctrl+U
        this.buffer = "";
        this.cursor = 0;
        return this.redraw();
      case "\x03": // Ctrl+C
        this.opts.write("^C");
        return this.newLine();
      case "\x1a": // Ctrl+Z
        this.opts.write("^Z");
        if (this.session.mode !== "user" && this.session.mode !== "privileged") {
          this.buffer = "end";
          return this.enter();
        }
        return this.newLine();
    }
    if (ch < " ") return; // ignore other control characters
    this.buffer = this.buffer.slice(0, this.cursor) + ch + this.buffer.slice(this.cursor);
    this.cursor++;
    if (this.cursor === this.buffer.length) this.opts.write(ch);
    else this.redraw();
  }

  private enter(): void {
    const line = this.buffer;
    this.opts.write("\r\n");
    const output = this.session.execute(line);
    for (const l of output) this.opts.write(`${l}\r\n`);
    this.opts.onExecute?.(line, output);
    this.buffer = "";
    this.cursor = 0;
    this.historyIndex = null;
    this.opts.write(this.session.prompt);
  }

  private newLine(): void {
    this.buffer = "";
    this.cursor = 0;
    this.historyIndex = null;
    this.opts.write(`\r\n${this.session.prompt}`);
  }

  private tab(): void {
    const done = this.session.complete(this.buffer.slice(0, this.cursor));
    if (done === null) {
      this.opts.write("\x07");
      return;
    }
    this.buffer = done + this.buffer.slice(this.cursor);
    this.cursor = done.length;
    this.redraw();
  }

  private help(): void {
    const lines = this.session.help(this.buffer.slice(0, this.cursor));
    this.opts.write(`?\r\n${lines.join("\r\n")}\r\n`);
    this.opts.write(this.session.prompt);
    this.opts.write(this.buffer);
    this.moveCursorFromEnd();
  }

  private historyPrev(): void {
    const h = this.session.history;
    if (h.length === 0) return;
    if (this.historyIndex === null) {
      this.draft = this.buffer;
      this.historyIndex = h.length - 1;
    } else if (this.historyIndex > 0) {
      this.historyIndex--;
    } else {
      this.opts.write("\x07");
      return;
    }
    this.setBuffer(h[this.historyIndex]!);
  }

  private historyNext(): void {
    if (this.historyIndex === null) return;
    const h = this.session.history;
    if (this.historyIndex < h.length - 1) {
      this.historyIndex++;
      this.setBuffer(h[this.historyIndex]!);
    } else {
      this.historyIndex = null;
      this.setBuffer(this.draft);
    }
  }

  private setBuffer(value: string): void {
    this.buffer = value;
    this.cursor = value.length;
    this.redraw();
  }

  /** Repaint prompt + buffer. Assumes the line fits the terminal width. */
  private redraw(): void {
    this.opts.write(`\r\x1b[K${this.session.prompt}${this.buffer}`);
    this.moveCursorFromEnd();
  }

  private moveCursorFromEnd(): void {
    const back = this.buffer.length - this.cursor;
    if (back > 0) this.opts.write(`\x1b[${back}D`);
  }
}
