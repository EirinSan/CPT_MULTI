import "dotenv/config";
import { defineConfig } from "prisma/config";

// DATABASE_URL is only needed for commands that talk to the database
// (migrate, studio); `prisma generate` works without it.
const url = process.env.DATABASE_URL;

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  ...(url ? { datasource: { url } } : {}),
});
