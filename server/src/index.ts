import { env, botEnabled } from "./env.js";
import { log } from "./lib/log.js";
import { runMigrations } from "./db/migrate.js";
import { sql } from "./db/index.js";
import { buildApi } from "./api/server.js";
import { startBot, stopBot } from "./bot/client.js";

async function main() {
  await runMigrations();
  log.info("Database migrated");

  const app = await buildApi();
  await app.listen({ port: env.PORT, host: "0.0.0.0" });

  if (botEnabled) await startBot(env.DISCORD_TOKEN);
  else log.warn("Bot disabled (no DISCORD_TOKEN or BOT_ENABLED=false) — running API only");

  const shutdown = async (signal: string) => {
    log.info({ signal }, "Shutting down");
    await app.close().catch(() => {});
    if (botEnabled) await stopBot().catch(() => {});
    await sql.end({ timeout: 5 }).catch(() => {});
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  log.fatal({ err }, "Fatal startup error");
  process.exit(1);
});
