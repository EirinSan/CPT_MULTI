import { describe, expect, it } from "vitest";
import { CliSession, LineDiscipline, createDevice } from "../src";

function setup() {
  const session = new CliSession(createDevice("switch-l2", "SW1"));
  let out = "";
  const ld = new LineDiscipline(session, { write: (d) => (out += d) });
  return { session, ld, read: () => { const o = out; out = ""; return o; } };
}

describe("LineDiscipline", () => {
  it("executes typed lines", () => {
    const { session, ld, read } = setup();
    ld.input("enable\r");
    expect(session.mode).toBe("privileged");
    expect(read().endsWith("SW1#")).toBe(true);
  });

  it("handles backspace and cursor movement", () => {
    const { session, ld } = setup();
    ld.input("enxble");
    ld.input("\x1b[D\x1b[D\x1b[D"); // cursor after "enx"
    ld.input("\x7fa\r");
    expect(session.mode).toBe("privileged");
  });

  it("recalls history with arrows", () => {
    const { session, ld } = setup();
    ld.input("enable\r");
    ld.input("disable\r");
    ld.input("\x1b[A\x1b[A\r");
    expect(session.mode).toBe("privileged");
  });

  it("completes with Tab and shows help with ?", () => {
    const { session, ld, read } = setup();
    ld.input("ena\t");
    expect(read()).toContain("SW1>enable ");
    ld.input("\r");
    expect(session.mode).toBe("privileged");
    read();
    ld.input("conf?");
    const out = read();
    expect(out).toContain("?\r\nconfigure\r\n");
    expect(out.endsWith("SW1#conf")).toBe(true);
  });

  it("Ctrl+Z leaves configuration mode", () => {
    const { session, ld } = setup();
    ld.input("en\rconf t\rint fa0/1\r");
    expect(session.mode).toBe("config-if");
    ld.input("\x1a");
    expect(session.mode).toBe("privileged");
  });
});
