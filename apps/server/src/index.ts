import { createPrismaClient } from "@cpt/db";
import { Server } from "socket.io";
import { buildApp } from "./app";
import { config } from "./config";
import { RankedService, type RankedIO } from "./realtime/ranked";

const prisma = createPrismaClient();
const app = await buildApp(prisma);

const io: RankedIO = new Server(app.server, { path: "/socket.io" });
const ranked = new RankedService(app, io);

app.addHook("onClose", async () => {
  ranked.stop();
  await io.close();
  await prisma.$disconnect();
});

await app.listen({ port: config.port, host: "0.0.0.0" });
ranked.start();
