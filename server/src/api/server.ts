import Fastify from "fastify";
import cookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import { ZodError } from "zod";
import { env, botEnabled } from "../env.js";
import { client } from "../bot/client.js";
import { registerAuth } from "./auth.js";
import { registerGuildRoutes } from "./routes/guild.js";
import { registerFeatureRoutes } from "./routes/features.js";
import { registerReportRoutes } from "./routes/reports.js";
import { registerBrandingRoutes } from "./routes/branding.js";
import { registerAutomationRoutes } from "./routes/automations.js";
import { apiError, ApiError } from "./errors.js";

export async function buildApi() {
  const app = Fastify({ logger: { level: env.LOG_LEVEL }, trustProxy: true });
  await app.register(cookie, { secret: env.SESSION_SECRET });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) {
      // Custom messages in zod schemas are translation keys (e.g. errors.invalidId)
      return apiError(reply, 400, "errors.invalidValues", undefined, {
        issues: err.issues.map((i) => ({ path: i.path.join("."), message: i.message, code: i.message.startsWith("errors.") ? i.message : undefined })),
      });
    }
    if (err instanceof ApiError) return apiError(reply, err.statusCode, err.code, err.params);
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    if (status >= 500) app.log.error(err);
    return status >= 500 ? apiError(reply, status, "errors.serverError") : reply.code(status).send({ error: (err as Error).message });
  });

  app.get("/api/health", async () => ({
    ok: true,
    bot: botEnabled ? (client.isReady() ? "ready" : "connecting") : "disabled",
    guilds: client.isReady() ? client.guilds.cache.size : 0,
    uptime: process.uptime(),
  }));

  registerAuth(app);
  registerGuildRoutes(app);
  registerFeatureRoutes(app);
  registerReportRoutes(app);
  registerBrandingRoutes(app);
  registerAutomationRoutes(app);

  // Serve the built dashboard (single page app) if present
  const here = path.dirname(fileURLToPath(import.meta.url));
  const dist = path.resolve(here, "../../../dashboard/dist");
  if (fs.existsSync(dist)) {
    await app.register(fastifyStatic, { root: dist, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith("/api/")) return apiError(reply, 404, "errors.notFound");
      return reply.sendFile("index.html");
    });
  }

  return app;
}
