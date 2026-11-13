import { Cron } from "croner";
import type { Client } from "discord.js";
import { eq } from "drizzle-orm";
import { db, schema } from "../../db/index.js";
import { enabledConfig } from "../../settings.js";
import { log } from "../../lib/log.js";

const jobs = new Map<number, Cron>();
let clientRef: Client | null = null;

/** Validates a cron expression + timezone and returns the next 3 run times (used by the dashboard preview) */
export function previewCron(pattern: string, timezone: string): Date[] {
  const c = new Cron(pattern, { timezone, paused: true });
  const runs = c.nextRuns(3);
  c.stop();
  return runs;
}

async function fire(id: number) {
  const [t] = await db.select().from(schema.timers).where(eq(schema.timers.id, id));
  if (!t || !t.enabled || !clientRef) return;
  if (!(await enabledConfig(t.guildId, "timers"))) return;
  const ch = await clientRef.channels.fetch(t.channelId).catch(() => null);
  if (!ch?.isSendable()) return log.warn({ timer: id }, "timer channel not sendable");
  await ch.send(t.content).catch((err) => log.warn({ err, timer: id }, "timer send failed"));
  await db.update(schema.timers).set({ lastRunAt: new Date() }).where(eq(schema.timers.id, id));
}

export function scheduleTimer(t: typeof schema.timers.$inferSelect) {
  jobs.get(t.id)?.stop();
  jobs.delete(t.id);
  if (!t.enabled) return;
  try {
    jobs.set(t.id, new Cron(t.cron, { timezone: t.timezone, protect: true }, () => void fire(t.id)));
  } catch (err) {
    log.warn({ err, timer: t.id }, "invalid cron");
  }
}

export function unscheduleTimer(id: number) {
  jobs.get(id)?.stop();
  jobs.delete(id);
}

export function nextRunOf(id: number) {
  return jobs.get(id)?.nextRun() ?? null;
}

export async function startTimers(client: Client) {
  clientRef = client;
  const rows = await db.select().from(schema.timers);
  rows.forEach(scheduleTimer);
  log.info({ count: jobs.size }, "timers scheduled");
}
