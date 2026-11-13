import { and, eq, lt, sql as dsql } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { log } from "../lib/log.js";

/**
 * Persistent job queue on Postgres. Jobs survive restarts, are claimed with
 * FOR UPDATE SKIP LOCKED (safe if two processes ever run), and retried with backoff.
 */
export type Job = typeof schema.jobs.$inferSelect;
type Handler = (payload: Record<string, unknown>, job: Job) => Promise<void>;

const handlers = new Map<string, Handler>();
const MAX_ATTEMPTS = 5;
const POLL_MS = 5_000;
let timer: NodeJS.Timeout | null = null;
let running = false;

export function registerJobHandler(type: string, fn: Handler) {
  handlers.set(type, fn);
}

export async function scheduleJob(opts: { type: string; runAt: Date; payload?: Record<string, unknown>; guildId?: string; dedupeKey?: string }) {
  const values = {
    type: opts.type,
    runAt: opts.runAt,
    payload: opts.payload ?? {},
    guildId: opts.guildId ?? null,
    dedupeKey: opts.dedupeKey ?? null,
  };
  if (!opts.dedupeKey) {
    const [row] = await db.insert(schema.jobs).values(values).returning();
    return row;
  }
  // Re-scheduling the same key replaces the previous job (e.g. extending a temporary ban)
  const [row] = await db
    .insert(schema.jobs)
    .values(values)
    .onConflictDoUpdate({
      target: schema.jobs.dedupeKey,
      set: { runAt: values.runAt, payload: values.payload, status: "pending", attempts: 0, lastError: null, updatedAt: new Date() },
    })
    .returning();
  return row;
}

export async function cancelJob(dedupeKey: string) {
  await db.delete(schema.jobs).where(and(eq(schema.jobs.dedupeKey, dedupeKey), eq(schema.jobs.status, "pending")));
}

/** Claims up to `limit` due jobs atomically */
async function claim(limit = 10): Promise<Job[]> {
  const rows = await db.execute(dsql`
    update jobs set status = 'running', attempts = attempts + 1, updated_at = now()
    where id in (
      select id from jobs where status = 'pending' and run_at <= now()
      order by run_at limit ${limit} for update skip locked
    )
    returning id, type, guild_id as "guildId", run_at as "runAt", payload, status, attempts,
              last_error as "lastError", dedupe_key as "dedupeKey", created_at as "createdAt", updated_at as "updatedAt"
  `);
  return rows as unknown as Job[];
}

async function runOne(job: Job) {
  const fn = handlers.get(job.type);
  try {
    if (!fn) throw new Error(`No handler for job type ${job.type}`);
    await fn(job.payload as Record<string, unknown>, job);
    await db.update(schema.jobs).set({ status: "done", updatedAt: new Date() }).where(eq(schema.jobs.id, job.id));
  } catch (err) {
    const message = (err as Error).message ?? String(err);
    const failed = job.attempts >= MAX_ATTEMPTS;
    await db
      .update(schema.jobs)
      .set({
        status: failed ? "failed" : "pending",
        lastError: message.slice(0, 1000),
        // exponential backoff: 1, 2, 4, 8 minutes
        runAt: failed ? new Date() : new Date(Date.now() + 60_000 * 2 ** (job.attempts - 1)),
        updatedAt: new Date(),
      })
      .where(eq(schema.jobs.id, job.id));
    log.warn({ err, job: job.id, type: job.type, attempts: job.attempts }, failed ? "job failed permanently" : "job failed, will retry");
  }
}

export async function tick() {
  if (running) return;
  running = true;
  try {
    for (;;) {
      const batch = await claim();
      if (!batch.length) break;
      for (const job of batch) await runOne(job);
    }
  } catch (err) {
    log.error({ err }, "job worker tick failed");
  } finally {
    running = false;
  }
}

export async function startJobWorker() {
  // Jobs left "running" by a crash are put back in the queue
  await db
    .update(schema.jobs)
    .set({ status: "pending" })
    .where(and(eq(schema.jobs.status, "running"), lt(schema.jobs.updatedAt, new Date(Date.now() - 10 * 60_000))));
  // Housekeeping: finished jobs are kept a week for debugging
  await db.delete(schema.jobs).where(and(eq(schema.jobs.status, "done"), lt(schema.jobs.updatedAt, new Date(Date.now() - 7 * 86400_000))));
  timer = setInterval(() => void tick(), POLL_MS);
  timer.unref();
  void tick();
}

export function stopJobWorker() {
  if (timer) clearInterval(timer);
  timer = null;
}
