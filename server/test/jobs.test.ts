import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema, sql } from "../src/db/index.js";
import { runMigrations } from "../src/db/migrate.js";
import { cancelJob, registerJobHandler, scheduleJob, tick } from "../src/core/jobs.js";

const ready = await sql`select 1`.then(() => true).catch(() => false);

describe.skipIf(!ready)("job queue (Postgres)", () => {
  beforeAll(async () => {
    await runMigrations();
    await db.delete(schema.jobs);
  });
  afterAll(async () => {
    await db.delete(schema.jobs);
    await sql.end();
  });

  it("runs due jobs and marks them done", async () => {
    const seen: unknown[] = [];
    registerJobHandler("test.ok", async (p) => void seen.push(p));
    const job = await scheduleJob({ type: "test.ok", runAt: new Date(Date.now() - 1000), payload: { n: 1 } });
    await scheduleJob({ type: "test.ok", runAt: new Date(Date.now() + 3600_000), payload: { n: 2 } });
    await tick();
    expect(seen).toEqual([{ n: 1 }]);
    const [row] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, job.id));
    expect(row.status).toBe("done");
  });

  it("retries failures later with backoff", async () => {
    registerJobHandler("test.fail", async () => {
      throw new Error("boom");
    });
    const job = await scheduleJob({ type: "test.fail", runAt: new Date(Date.now() - 1000) });
    await tick();
    const [row] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, job.id));
    expect(row.status).toBe("pending");
    expect(row.attempts).toBe(1);
    expect(row.lastError).toBe("boom");
    expect(row.runAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("replaces a job with the same dedupe key and can cancel it", async () => {
    const a = await scheduleJob({ type: "test.ok", runAt: new Date(Date.now() + 1000), dedupeKey: "unban:1:2", payload: { v: 1 } });
    const b = await scheduleJob({ type: "test.ok", runAt: new Date(Date.now() + 9000), dedupeKey: "unban:1:2", payload: { v: 2 } });
    expect(b.id).toBe(a.id);
    expect(b.payload).toEqual({ v: 2 });
    await cancelJob("unban:1:2");
    const rows = await db.select().from(schema.jobs).where(eq(schema.jobs.dedupeKey, "unban:1:2"));
    expect(rows).toEqual([]);
  });
});
