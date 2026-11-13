import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { and, asc, desc, eq, ilike, or, sql as dsql } from "drizzle-orm";
import { db, schema } from "../../db/index.js";
import { client, syncGuildCommands } from "../../bot/client.js";
import { requireGuildAccess } from "../auth.js";
import { audit, discordGuild, type GP } from "./guild.js";
import { levelFromXp, totalXpForLevel, syncRewardRoles } from "../../bot/modules/levels.js";
import { publishReactionRoles, unpublishReactionRoles, loadReactionRoles } from "../../bot/modules/reactionRoles.js";
import { commandNameRe } from "../../bot/modules/customCommands.js";
import { commands as builtinCommands } from "../../bot/registry.js";
import { previewCron, scheduleTimer, unscheduleTimer, nextRunOf } from "../../bot/modules/timers.js";
import { previewMee6, startMee6Import, getImportJob } from "../../mee6/import.js";
import { getModule } from "../../settings.js";
import { apiError } from "../errors.js";

type IdP = { Params: { guildId: string; id: string } };
const snowflake = z.string().regex(/^\d{15,22}$/);

const rrBody = z.object({
  channelId: snowflake,
  title: z.string().max(256).default(""),
  description: z.string().max(3000).default(""),
  color: z.string().regex(/^#[0-9a-f]{6}$/i).default("#8b5cf6"),
  mode: z.enum(["normal", "unique", "verify"]).default("normal"),
  /** Attach to an existing message (e.g. one MEE6 posted) instead of posting a new one */
  messageId: snowflake.nullable().optional(),
  entries: z
    .array(z.object({ emoji: z.string().min(1).max(100), roleId: snowflake, label: z.string().max(100).optional() }))
    .min(1)
    .max(20),
});

const commandBody = z.object({
  name: z.string().regex(commandNameRe, "errors.commandName"),
  description: z.string().max(100).default("Custom command"),
  response: z.string().min(1).max(2000),
  ephemeral: z.boolean().default(false),
  addRoleIds: z.array(snowflake).default([]),
  removeRoleIds: z.array(snowflake).default([]),
  allowedRoleIds: z.array(snowflake).default([]),
  enabled: z.boolean().default(true),
});

const timerBody = z.object({
  name: z.string().max(100).default(""),
  channelId: snowflake,
  content: z.string().min(1).max(2000),
  cron: z.string().min(9).max(100),
  timezone: z.string().default("Europe/Stockholm"),
  enabled: z.boolean().default(true),
});

async function resync(guildId: string) {
  const g = discordGuild(guildId);
  if (g) await syncGuildCommands(g).catch(() => {});
}

export function registerFeatureRoutes(app: FastifyInstance) {
  app.register(async (r) => {
    r.addHook("preHandler", requireGuildAccess);

    /* ---------------- Levels ---------------- */

    r.get<GP & { Querystring: { page?: string; search?: string } }>("/api/guilds/:guildId/levels", async (req) => {
      const page = Math.max(0, Number(req.query.page ?? 0));
      const search = req.query.search?.trim() ?? "";
      // rank() is computed over the whole server so searching keeps the real placement
      const rows = (await db.execute(dsql`
        with ranked as (
          select user_id, username, avatar, xp, message_count, rank() over (order by xp desc)::int as rank
          from member_levels where guild_id = ${req.params.guildId}
        )
        select * from ranked
        where ${search} = '' or username ilike ${"%" + search + "%"} or user_id = ${search}
        order by rank limit 50 offset ${page * 50}
      `)) as unknown as { user_id: string; username: string; avatar: string | null; xp: string | number; message_count: number; rank: number }[];
      const [{ total }] = await db
        .select({ total: dsql<number>`count(*)::int` })
        .from(schema.memberLevels)
        .where(eq(schema.memberLevels.guildId, req.params.guildId));
      return {
        total,
        page,
        rows: rows.map((r) => ({
          userId: r.user_id,
          username: r.username,
          avatar: r.avatar,
          xp: Number(r.xp),
          messageCount: r.message_count,
          rank: r.rank,
          ...levelFromXp(Number(r.xp)),
        })),
      };
    });

    r.patch<IdP & { Body: { xp?: number; level?: number } }>("/api/guilds/:guildId/levels/:id", async (req, reply) => {
      const body = z.object({ xp: z.number().int().min(0).optional(), level: z.number().int().min(0).max(1000).optional() }).parse(req.body);
      const xp = body.level !== undefined ? totalXpForLevel(body.level) : body.xp;
      if (xp === undefined) return apiError(reply, 400, "errors.xpOrLevel");
      const t = schema.memberLevels;
      const level = levelFromXp(xp).level;
      await db
        .insert(t)
        .values({ guildId: req.params.guildId, userId: req.params.id, xp, level })
        .onConflictDoUpdate({ target: [t.guildId, t.userId], set: { xp, level } });
      await audit(req.params.guildId, req.session!.userId, "levels.set", { userId: req.params.id, xp });
      const g = discordGuild(req.params.guildId);
      const member = g ? await g.members.fetch(req.params.id).catch(() => null) : null;
      if (member) await syncRewardRoles(member, level, (await getModule(req.params.guildId, "levels")).config).catch(() => {});
      return { xp, level };
    });

    r.delete<GP>("/api/guilds/:guildId/levels", async (req) => {
      await db.delete(schema.memberLevels).where(eq(schema.memberLevels.guildId, req.params.guildId));
      await audit(req.params.guildId, req.session!.userId, "levels.reset");
      return { ok: true };
    });

    /* ---------------- MEE6 import ---------------- */

    r.get<GP>("/api/guilds/:guildId/import/mee6/preview", async (req, reply) => {
      try {
        return await previewMee6(req.params.guildId);
      } catch (err) {
        const e = err as Error & { code?: string; params?: Record<string, string | number> };
        return e.code ? apiError(reply, 400, e.code, e.params) : reply.code(400).send({ error: e.message });
      }
    });
    r.post<GP>("/api/guilds/:guildId/import/mee6", async (req) => {
      const opts = z
        .object({
          mode: z.enum(["replace", "max", "add"]).default("max"),
          importRewards: z.boolean().default(true),
          importXpSettings: z.boolean().default(true),
        })
        .parse(req.body ?? {});
      await audit(req.params.guildId, req.session!.userId, "import.mee6", opts);
      return startMee6Import(req.params.guildId, opts);
    });
    r.get<GP>("/api/guilds/:guildId/import/mee6", async (req) => getImportJob(req.params.guildId));

    /* ---------------- Reaction roles ---------------- */

    r.get<GP>("/api/guilds/:guildId/reaction-roles", async (req) =>
      db
        .select()
        .from(schema.reactionRoleMessages)
        .where(eq(schema.reactionRoleMessages.guildId, req.params.guildId))
        .orderBy(asc(schema.reactionRoleMessages.id)),
    );

    r.post<GP>("/api/guilds/:guildId/reaction-roles", async (req, reply) => {
      const body = rrBody.parse(req.body);
      const [row] = await db
        .insert(schema.reactionRoleMessages)
        .values({ ...body, messageId: body.messageId ?? null, guildId: req.params.guildId })
        .returning();
      await audit(req.params.guildId, req.session!.userId, "reactionRoles.create", { id: row.id });
      try {
        const messageId = await publishReactionRoles(client, row.id);
        return { ...row, messageId };
      } catch (err) {
        return reply.code(207).send({ ...row, warning: (err as Error & { code?: string }).code ?? (err as Error).message });
      }
    });

    r.put<IdP>("/api/guilds/:guildId/reaction-roles/:id", async (req, reply) => {
      const body = rrBody.parse(req.body);
      const t = schema.reactionRoleMessages;
      const id = Number(req.params.id);
      const [existing] = await db.select().from(t).where(and(eq(t.id, id), eq(t.guildId, req.params.guildId)));
      if (!existing) return apiError(reply, 404, "errors.notFound");
      // Moving to another channel = post a fresh message there
      const messageId = body.channelId !== existing.channelId ? null : (body.messageId ?? existing.messageId);
      if (body.channelId !== existing.channelId) await unpublishReactionRoles(client, existing);
      const [row] = await db.update(t).set({ ...body, messageId }).where(eq(t.id, id)).returning();
      await audit(req.params.guildId, req.session!.userId, "reactionRoles.update", { id });
      try {
        return { ...row, messageId: await publishReactionRoles(client, id) };
      } catch (err) {
        return reply.code(207).send({ ...row, warning: (err as Error & { code?: string }).code ?? (err as Error).message });
      }
    });

    r.delete<IdP & { Querystring: { deleteMessage?: string } }>("/api/guilds/:guildId/reaction-roles/:id", async (req) => {
      const t = schema.reactionRoleMessages;
      const [row] = await db
        .delete(t)
        .where(and(eq(t.id, Number(req.params.id)), eq(t.guildId, req.params.guildId)))
        .returning();
      if (row && req.query.deleteMessage !== "false") await unpublishReactionRoles(client, row);
      await loadReactionRoles();
      await audit(req.params.guildId, req.session!.userId, "reactionRoles.delete", { id: req.params.id });
      return { ok: true };
    });

    /* ---------------- Custom commands ---------------- */

    r.get<GP>("/api/guilds/:guildId/commands", async (req) =>
      db.select().from(schema.customCommands).where(eq(schema.customCommands.guildId, req.params.guildId)).orderBy(asc(schema.customCommands.name)),
    );

    // Static list too, so the check works even when the API runs without the bot (BOT_ENABLED=false)
    const reserved = new Set(["rank", "leaderboard", "warn", "timeout", "kick", "ban", "unban", "purge", "cases", "voice"]);
    const checkName = (name: string) =>
      builtinCommands.has(name) || reserved.has(name);

    r.post<GP>("/api/guilds/:guildId/commands", async (req, reply) => {
      const body = commandBody.parse(req.body);
      const clash = checkName(body.name);
      if (clash) return apiError(reply, 400, "errors.builtinCommand", { name: body.name });
      const [row] = await db
        .insert(schema.customCommands)
        .values({ ...body, guildId: req.params.guildId })
        .onConflictDoNothing()
        .returning();
      if (!row) return apiError(reply, 409, "errors.commandExists", { name: body.name });
      await audit(req.params.guildId, req.session!.userId, "commands.create", { name: body.name });
      await resync(req.params.guildId);
      return row;
    });

    r.put<IdP>("/api/guilds/:guildId/commands/:id", async (req, reply) => {
      const body = commandBody.parse(req.body);
      const clash = checkName(body.name);
      if (clash) return apiError(reply, 400, "errors.builtinCommand", { name: body.name });
      const t = schema.customCommands;
      const [row] = await db
        .update(t)
        .set(body)
        .where(and(eq(t.id, Number(req.params.id)), eq(t.guildId, req.params.guildId)))
        .returning();
      await audit(req.params.guildId, req.session!.userId, "commands.update", { name: body.name });
      await resync(req.params.guildId);
      return row;
    });

    r.delete<IdP>("/api/guilds/:guildId/commands/:id", async (req) => {
      const t = schema.customCommands;
      await db.delete(t).where(and(eq(t.id, Number(req.params.id)), eq(t.guildId, req.params.guildId)));
      await audit(req.params.guildId, req.session!.userId, "commands.delete", { id: req.params.id });
      await resync(req.params.guildId);
      return { ok: true };
    });

    /* ---------------- Timers ---------------- */

    r.get<GP>("/api/guilds/:guildId/timers", async (req) => {
      const rows = await db.select().from(schema.timers).where(eq(schema.timers.guildId, req.params.guildId)).orderBy(asc(schema.timers.id));
      return rows.map((t) => ({ ...t, nextRunAt: nextRunOf(t.id) }));
    });

    r.post<GP>("/api/guilds/:guildId/timers/preview", async (req, reply) => {
      const { cron, timezone } = z.object({ cron: z.string(), timezone: z.string().default("Europe/Stockholm") }).parse(req.body);
      try {
        return { runs: previewCron(cron, timezone) };
      } catch (err) {
        return apiError(reply, 400, "errors.invalidSchedule", { detail: (err as Error).message });
      }
    });

    const validCron = (body: z.infer<typeof timerBody>) => {
      try {
        previewCron(body.cron, body.timezone);
        return null;
      } catch (err) {
        return (err as Error).message;
      }
    };

    r.post<GP>("/api/guilds/:guildId/timers", async (req, reply) => {
      const body = timerBody.parse(req.body);
      const bad = validCron(body);
      if (bad) return apiError(reply, 400, "errors.invalidSchedule", { detail: bad });
      const [row] = await db.insert(schema.timers).values({ ...body, guildId: req.params.guildId }).returning();
      scheduleTimer(row);
      await audit(req.params.guildId, req.session!.userId, "timers.create", { id: row.id });
      return { ...row, nextRunAt: nextRunOf(row.id) };
    });

    r.put<IdP>("/api/guilds/:guildId/timers/:id", async (req, reply) => {
      const body = timerBody.parse(req.body);
      const bad = validCron(body);
      if (bad) return apiError(reply, 400, "errors.invalidSchedule", { detail: bad });
      const t = schema.timers;
      const [row] = await db
        .update(t)
        .set(body)
        .where(and(eq(t.id, Number(req.params.id)), eq(t.guildId, req.params.guildId)))
        .returning();
      if (!row) return apiError(reply, 404, "errors.notFound");
      scheduleTimer(row);
      await audit(req.params.guildId, req.session!.userId, "timers.update", { id: row.id });
      return { ...row, nextRunAt: nextRunOf(row.id) };
    });

    r.post<IdP>("/api/guilds/:guildId/timers/:id/test", async (req, reply) => {
      const t = schema.timers;
      const [row] = await db.select().from(t).where(and(eq(t.id, Number(req.params.id)), eq(t.guildId, req.params.guildId)));
      if (!row) return apiError(reply, 404, "errors.notFound");
      const ch = await client.channels.fetch(row.channelId).catch(() => null);
      if (!ch?.isSendable()) return apiError(reply, 400, "errors.botCannotWrite");
      await ch.send(row.content);
      return { ok: true };
    });

    r.delete<IdP>("/api/guilds/:guildId/timers/:id", async (req) => {
      const t = schema.timers;
      await db.delete(t).where(and(eq(t.id, Number(req.params.id)), eq(t.guildId, req.params.guildId)));
      unscheduleTimer(Number(req.params.id));
      await audit(req.params.guildId, req.session!.userId, "timers.delete", { id: req.params.id });
      return { ok: true };
    });

    /* ---------------- Moderation cases ---------------- */

    r.get<GP & { Querystring: { userId?: string; action?: string; page?: string } }>("/api/guilds/:guildId/cases", async (req) => {
      const t = schema.modCases;
      const page = Math.max(0, Number(req.query.page ?? 0));
      const conds = [eq(t.guildId, req.params.guildId)];
      if (req.query.userId) conds.push(or(eq(t.userId, req.query.userId), ilike(t.userTag, `%${req.query.userId}%`))!);
      if (req.query.action) conds.push(eq(t.action, req.query.action));
      const rows = await db
        .select()
        .from(t)
        .where(and(...conds))
        .orderBy(desc(t.caseNumber))
        .limit(50)
        .offset(page * 50);
      return { page, rows };
    });

    r.delete<IdP>("/api/guilds/:guildId/cases/:id", async (req) => {
      const t = schema.modCases;
      await db.delete(t).where(and(eq(t.id, Number(req.params.id)), eq(t.guildId, req.params.guildId)));
      await audit(req.params.guildId, req.session!.userId, "cases.delete", { id: req.params.id });
      return { ok: true };
    });

    /* What the bot did (or failed to do) and why — roles it couldn't give, DMs that bounced, etc. */
    r.get<GP & { Querystring: { failed?: string; source?: string } }>("/api/guilds/:guildId/action-log", async (req) => {
      const tbl = schema.actionLog;
      const conds = [eq(tbl.guildId, req.params.guildId)];
      if (req.query.failed === "1") conds.push(eq(tbl.ok, false));
      if (req.query.source) conds.push(eq(tbl.source, req.query.source));
      return db.select().from(tbl).where(and(...conds)).orderBy(desc(tbl.createdAt)).limit(200);
    });

    r.get<GP>("/api/guilds/:guildId/audit", async (req) =>
      db
        .select()
        .from(schema.auditLog)
        .where(eq(schema.auditLog.guildId, req.params.guildId))
        .orderBy(desc(schema.auditLog.createdAt))
        .limit(100),
    );
  });
}
