import { sql as dsql } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { getModule, saveModule } from "../settings.js";
import { levelFromXp } from "../bot/modules/levels.js";
import { log } from "../lib/log.js";

/**
 * MEE6 has an undocumented but widely used public endpoint for the leaderboard:
 *   https://mee6.xyz/api/plugins/levels/leaderboard/{guildId}?page=N&limit=1000
 * It only works when the server has "Make my server's leaderboard public" enabled in MEE6.
 * It can change without notice — every field is treated as optional.
 */
const BASE = process.env.MEE6_API_BASE ?? "https://mee6.xyz/api/plugins/levels/leaderboard";

interface Mee6Player {
  id: string;
  username?: string;
  avatar?: string | null;
  xp?: number;
  level?: number;
  message_count?: number;
}
interface Mee6Page {
  players?: Mee6Player[];
  role_rewards?: { rank: number; role?: { id: string; name?: string } }[];
  xp_per_message?: [number, number];
  xp_rate?: number;
  guild?: { name?: string };
}

export type ImportMode = "replace" | "max" | "add";

export interface ImportJob {
  guildId: string;
  status: "running" | "done" | "error";
  mode: ImportMode;
  importRewards: boolean;
  importXpSettings: boolean;
  pages: number;
  players: number;
  rewards: number;
  error?: string;
  startedAt: string;
  finishedAt?: string;
}

const jobs = new Map<string, ImportJob>();
export const getImportJob = (guildId: string) => jobs.get(guildId) ?? null;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchPage(guildId: string, page: number): Promise<Mee6Page> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(`${BASE}/${guildId}?page=${page}&limit=1000`, {
      headers: { "User-Agent": "GuildKitBot-Importer/0.1", Accept: "application/json" },
    }).catch(() => {
      throw new Error("Kunde inte nå MEE6. Kontrollera att servern har internetåtkomst och försök igen.");
    });
    if (res.status === 429) {
      const wait = Number(res.headers.get("retry-after") ?? 2) * 1000;
      await sleep(Math.max(wait, 1000) * (attempt + 1));
      continue;
    }
    if (res.status === 401 || res.status === 403)
      throw new Error("MEE6-leaderboarden är inte publik. Slå på “Make my server's leaderboard public” i MEE6 och försök igen.");
    if (res.status === 404) throw new Error("MEE6 hittade ingen leaderboard för den här servern.");
    if (!res.ok) throw new Error(`MEE6 svarade ${res.status}`);
    return (await res.json()) as Mee6Page;
  }
  throw new Error("MEE6 rate-limitade för många gånger, försök igen om en stund.");
}

/** Fetch only the first page — used by the dashboard to preview before importing */
export async function previewMee6(guildId: string) {
  const p = await fetchPage(guildId, 0);
  return {
    samplePlayers: (p.players ?? []).slice(0, 10).map((x) => ({ id: x.id, username: x.username, xp: x.xp ?? 0, level: x.level ?? 0 })),
    playersOnFirstPage: p.players?.length ?? 0,
    roleRewards: (p.role_rewards ?? []).map((r) => ({ level: r.rank, roleId: r.role?.id, roleName: r.role?.name })),
    xpPerMessage: p.xp_per_message ?? null,
    xpRate: p.xp_rate ?? null,
  };
}

export function startMee6Import(guildId: string, opts: { mode: ImportMode; importRewards: boolean; importXpSettings: boolean }) {
  const existing = jobs.get(guildId);
  if (existing?.status === "running") return existing;
  const job: ImportJob = {
    guildId,
    status: "running",
    ...opts,
    pages: 0,
    players: 0,
    rewards: 0,
    startedAt: new Date().toISOString(),
  };
  jobs.set(guildId, job);
  void run(job).catch((err: Error) => {
    job.status = "error";
    job.error = err.message;
    job.finishedAt = new Date().toISOString();
    log.warn({ err, guildId }, "MEE6 import failed");
  });
  return job;
}

async function run(job: ImportJob) {
  const t = schema.memberLevels;
  let first: Mee6Page | null = null;
  for (let page = 0; page < 500; page++) {
    const data = await fetchPage(job.guildId, page);
    if (page === 0) first = data;
    const raw = (data.players ?? []).filter((p) => p.id && typeof p.xp === "number");
    if (!raw.length) break;
    // One upsert can't touch the same row twice, so dedupe within the page
    const players = [...new Map(raw.map((p) => [String(p.id), p])).values()];

    const rows = players.map((p) => ({
      guildId: job.guildId,
      userId: String(p.id),
      username: p.username ?? "",
      avatar: p.avatar ?? null,
      xp: Math.max(0, Math.floor(p.xp!)),
      level: levelFromXp(Math.max(0, Math.floor(p.xp!))).level,
      messageCount: p.message_count ?? 0,
    }));

    const xpExpr =
      job.mode === "replace" ? dsql`excluded.xp` : job.mode === "add" ? dsql`${t.xp} + excluded.xp` : dsql`greatest(${t.xp}, excluded.xp)`;
    await db
      .insert(t)
      .values(rows)
      .onConflictDoUpdate({
        target: [t.guildId, t.userId],
        set: {
          xp: xpExpr,
          messageCount: dsql`greatest(${t.messageCount}, excluded.message_count)`,
          username: dsql`case when excluded.username <> '' then excluded.username else ${t.username} end`,
          avatar: dsql`coalesce(excluded.avatar, ${t.avatar})`,
        },
      });
    job.pages++;
    job.players += rows.length;
    if (raw.length < 1000) break;
    await sleep(750); // be polite
  }

  // Recompute stored levels for rows whose XP changed through add/max merges
  const all = await db.select({ userId: t.userId, xp: t.xp, level: t.level }).from(t).where(dsql`${t.guildId} = ${job.guildId}`);
  for (const r of all) {
    const lvl = levelFromXp(r.xp).level;
    if (lvl !== r.level) await db.update(t).set({ level: lvl }).where(dsql`${t.guildId} = ${job.guildId} and ${t.userId} = ${r.userId}`);
  }

  if (first && (job.importRewards || job.importXpSettings)) {
    const { enabled, config } = await getModule(job.guildId, "levels");
    const next = structuredClone(config);
    if (job.importRewards && first.role_rewards?.length) {
      const map = new Map(next.roleRewards.map((r) => [`${r.level}:${r.roleId}`, r]));
      for (const r of first.role_rewards) if (r.role?.id) map.set(`${r.rank}:${r.role.id}`, { level: r.rank, roleId: r.role.id });
      next.roleRewards = [...map.values()].sort((a, b) => a.level - b.level);
      job.rewards = first.role_rewards.length;
    }
    if (job.importXpSettings) {
      if (first.xp_per_message?.length === 2) [next.xpMin, next.xpMax] = first.xp_per_message;
      if (typeof first.xp_rate === "number" && first.xp_rate > 0) next.multiplier = first.xp_rate;
    }
    await saveModule(job.guildId, "levels", { enabled, config: next });
  }

  job.status = "done";
  job.finishedAt = new Date().toISOString();
  log.info({ guildId: job.guildId, players: job.players }, "MEE6 import done");
}
