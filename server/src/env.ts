import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  DATABASE_URL: z.string().min(1),
  DISCORD_TOKEN: z.string().default(""),
  DISCORD_CLIENT_ID: z.string().default(""),
  DISCORD_CLIENT_SECRET: z.string().default(""),
  /** Public URL of the dashboard, e.g. https://bot.example.com — used for the OAuth redirect. */
  PUBLIC_URL: z.string().url().default("http://localhost:3000"),
  /** Random 32+ char string used to sign session cookies. */
  SESSION_SECRET: z.string().min(32),
  PORT: z.coerce.number().default(3000),
  /** Comma separated Discord user IDs that can manage every server the bot is in. */
  OWNER_IDS: z.string().default(""),
  /** Set to "false" to run only the API (useful when developing the dashboard without a bot token). */
  BOT_ENABLED: z.string().default("true"),
  LOG_LEVEL: z.string().default("info"),
});

export const env = schema.parse(process.env);
export const ownerIds = new Set(env.OWNER_IDS.split(",").map((s) => s.trim()).filter(Boolean));
export const botEnabled = env.BOT_ENABLED !== "false" && env.DISCORD_TOKEN.length > 0;
