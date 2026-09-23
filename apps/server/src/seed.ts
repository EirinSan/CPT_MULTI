/** Upserts the mission catalog into the Challenge table. */
import { createPrismaClient } from "@cpt/db";
import { MISSIONS } from "@cpt/missions";
import "./config";

const prisma = createPrismaClient();

for (const m of MISSIONS) {
  const content = { initialTopology: m.topology as object, targetStateAssertions: m.assertions as object };
  const existing = await prisma.challenge.findUnique({ where: { slug: m.slug } });
  const changed =
    existing &&
    (JSON.stringify(existing.initialTopology) !== JSON.stringify(m.topology) ||
      JSON.stringify(existing.targetStateAssertions) !== JSON.stringify(m.assertions));
  const data = {
    title: m.title,
    summary: m.summary,
    description: m.briefing,
    difficulty: m.difficulty,
    category: m.category,
    modes: m.modes,
    tags: m.tags,
    timeLimit: m.timeLimit,
    parTimeSec: m.parTimeSec,
    isPublished: true,
    ...content,
  };
  await prisma.challenge.upsert({
    where: { slug: m.slug },
    create: { slug: m.slug, ...data },
    update: { ...data, ...(changed ? { version: { increment: 1 } } : {}) },
  });
  console.log(`${existing ? (changed ? "updated" : "unchanged") : "created"}  ${m.slug}`);
}
await prisma.$disconnect();
