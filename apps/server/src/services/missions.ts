/**
 * Missions as stored in the DB (`Challenge`), plus server-side replay: the
 * server never trusts the client's view of the network, it re-executes the
 * command log on its own Lab and evaluates the hidden assertions.
 */
import { Lab, evaluateAssertions } from "@cpt/cli-engine";
import type { Challenge, PrismaClient } from "@cpt/db";
import type {
  AssertionSet,
  CommandEntry,
  MissionDetail,
  MissionSummary,
  Topology,
} from "@cpt/shared";
import { config } from "../config";

export interface MissionRecord {
  id: string;
  version: number;
  detail: MissionDetail;
  assertions: AssertionSet;
}

export function toSummary(c: Challenge): MissionSummary {
  const assertions = c.targetStateAssertions as unknown as AssertionSet;
  return {
    slug: c.slug,
    title: c.title,
    summary: c.summary,
    difficulty: c.difficulty,
    category: c.category,
    modes: c.modes,
    timeLimit: c.timeLimit,
    parTimeSec: c.parTimeSec,
    objectiveCount: assertions.all.length,
  };
}

export function toRecord(c: Challenge): MissionRecord {
  const assertions = c.targetStateAssertions as unknown as AssertionSet;
  return {
    id: c.id,
    version: c.version,
    assertions,
    detail: {
      ...toSummary(c),
      briefing: c.description,
      topology: c.initialTopology as unknown as Topology,
      objectives: assertions.all.map((a) => ({ label: a.label })),
    },
  };
}

export async function findMission(prisma: PrismaClient, slug: string): Promise<MissionRecord | null> {
  const c = await prisma.challenge.findUnique({ where: { slug } });
  return c && c.isPublished ? toRecord(c) : null;
}

export class InvalidCommandLog extends Error {}

/** Validate an untrusted command log (shape and size). */
export function parseCommandLog(input: unknown, topology: Topology): CommandEntry[] {
  if (!Array.isArray(input)) throw new InvalidCommandLog("commands must be an array");
  if (input.length > config.maxCommands) throw new InvalidCommandLog("too many commands");
  const consoles = new Set(topology.devices.filter((d) => d.kind !== "pc" && d.kind !== "server").map((d) => d.id));
  return input.map((raw) => {
    const c = raw as Partial<CommandEntry>;
    if (typeof c?.deviceId !== "string" || !consoles.has(c.deviceId)) throw new InvalidCommandLog("bad deviceId");
    if (typeof c.line !== "string" || c.line.length > config.maxLineLength) throw new InvalidCommandLog("bad line");
    return { deviceId: c.deviceId, line: c.line, t: typeof c.t === "number" ? c.t : 0 };
  });
}

export interface ReplayResult {
  results: boolean[];
  solved: boolean;
  syntaxErrors: number;
}

export function replay(mission: MissionRecord, commands: CommandEntry[]): ReplayResult {
  const lab = new Lab(mission.detail.topology);
  for (const c of commands) lab.execute(c.deviceId, c.line);
  const results = evaluateAssertions(lab, mission.assertions).map((r) => r.passed);
  let syntaxErrors = 0;
  for (const node of lab.nodes.values()) syntaxErrors += node.session?.syntaxErrors ?? 0;
  return { results, solved: results.every(Boolean), syntaxErrors };
}
