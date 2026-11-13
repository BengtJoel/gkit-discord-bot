import type { FastifyInstance } from "fastify";
import { sql as dsql } from "drizzle-orm";
import { db } from "../../db/index.js";
import { requireGuildAccess } from "../auth.js";
import { discordGuild, type GP } from "./guild.js";
import { getModule } from "../../settings.js";
import { levelFromXp } from "../../bot/modules/levels.js";
import { t, isLang } from "../../i18n/index.js";

type Q = { Querystring: { days?: string; from?: string; to?: string } };

/** Resolves the period from ?days=N or ?from=YYYY-MM-DD&to=YYYY-MM-DD (inclusive, Stockholm days) */
function period(q: Q["Querystring"]) {
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Stockholm" });
  if (q.from && q.to && iso.test(q.from) && iso.test(q.to)) return { from: q.from, to: q.to };
  const days = Math.min(Math.max(Number(q.days ?? 30) || 30, 1), 730);
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - (days - 1));
  return { from: d.toISOString().slice(0, 10), to: today };
}

const rowsOf = <T>(r: unknown) => r as T[];

const memberSort: Record<string, string> = {
  messages: "messages",
  voice: "voice_seconds",
  reactions: "reactions",
  activeDays: "active_days",
  lastSeen: "last_seen",
  joined: "joined_at",
  xp: "xp",
  name: "lower(display_name)",
};

async function memberReport(guildId: string, q: Record<string, string | undefined>) {
  const { from, to } = period(q);
  const sortCol = memberSort[q.sort ?? "messages"] ?? "messages";
  const dir = q.dir === "asc" ? "asc" : "desc";
  const search = (q.search ?? "").trim();
  const status = q.status ?? "current"; // current | all | left | inactive
  const { config } = await getModule(guildId, "activity");
  const inactiveDays = Number(q.inactiveDays ?? config.inactiveDays);
  const limit = Math.min(Number(q.limit ?? 100) || 100, 5000);
  const offset = Math.max(Number(q.page ?? 0), 0) * limit;

  return rowsOf<Record<string, unknown>>(
    await db.execute(dsql`
      with agg as (
        select user_id,
          sum(messages)::int as messages,
          sum(voice_seconds)::int as voice_seconds,
          sum(reactions)::int as reactions,
          sum(commands)::int as commands,
          count(*) filter (where messages > 0 or voice_seconds > 0)::int as active_days
        from activity_daily
        where guild_id = ${guildId} and day between ${from}::date and ${to}::date
        group by user_id
      ),
      mem as (select * from members where guild_id = ${guildId}),
      base as (
        select coalesce(m.user_id, a.user_id) as user_id,
          coalesce(nullif(m.display_name, ''), m.username, l.username, '') as display_name,
          coalesce(m.username, l.username, '') as username,
          coalesce(m.avatar, l.avatar) as avatar,
          coalesce(m.bot, false) as bot,
          m.joined_at, m.left_at, m.last_message_at, m.last_voice_at,
          greatest(m.last_message_at, m.last_voice_at) as last_seen,
          coalesce(a.messages, 0) as messages,
          coalesce(a.voice_seconds, 0) as voice_seconds,
          coalesce(a.reactions, 0) as reactions,
          coalesce(a.commands, 0) as commands,
          coalesce(a.active_days, 0) as active_days,
          coalesce(l.xp, 0)::float8 as xp
        from mem m
        full outer join agg a on a.user_id = m.user_id
        left join member_levels l on l.guild_id = ${guildId} and l.user_id = coalesce(m.user_id, a.user_id)
      )
      select *, count(*) over ()::int as total_count from base
      where not bot
        and (${search} = '' or display_name ilike ${"%" + search + "%"} or username ilike ${"%" + search + "%"} or user_id = ${search})
        and (
          ${status} = 'all'
          or (${status} = 'current' and left_at is null)
          or (${status} = 'left' and left_at is not null)
          or (${status} = 'inactive' and left_at is null
              and (last_seen is null or last_seen < now() - make_interval(days => ${inactiveDays})))
        )
      order by ${dsql.raw(sortCol)} ${dsql.raw(dir)} nulls last, user_id
      limit ${limit} offset ${offset}
    `),
  );
}

function toCsv(rows: Record<string, unknown>[], columns: [string, string][]) {
  const esc = (v: unknown) => {
    const s = v instanceof Date ? v.toISOString() : v == null ? "" : String(v);
    return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns.map((c) => c[1]).join(";"), ...rows.map((r) => columns.map((c) => esc(r[c[0]])).join(";"))].join("\n");
}

export function registerReportRoutes(app: FastifyInstance) {
  app.register(async (r) => {
    r.addHook("preHandler", requireGuildAccess);

    r.get<GP & Q>("/api/guilds/:guildId/reports/overview", async (req) => {
      const gid = req.params.guildId;
      const { from, to } = period(req.query);
      const series = rowsOf<Record<string, unknown>>(
        await db.execute(dsql`
          with days as (select generate_series(${from}::date, ${to}::date, interval '1 day')::date as day),
          act as (
            select day, sum(messages)::int as messages, sum(voice_seconds)::int as voice_seconds,
                   count(*) filter (where messages > 0 or voice_seconds > 0)::int as active_users
            from activity_daily where guild_id = ${gid} and day between ${from}::date and ${to}::date group by day
          ),
          ev as (
            select (created_at at time zone 'Europe/Stockholm')::date as day,
                   count(*) filter (where type = 'member_join')::int as joins,
                   count(*) filter (where type = 'member_leave')::int as leaves,
                   count(*) filter (where type in ('mod_action','automod'))::int as mod_actions
            from events where guild_id = ${gid}
              and created_at >= ${from}::date and created_at < ${to}::date + 1
            group by 1
          )
          select to_char(d.day, 'YYYY-MM-DD') as day,
                 coalesce(a.messages, 0) as messages, coalesce(a.voice_seconds, 0) as voice_seconds,
                 coalesce(a.active_users, 0) as active_users,
                 coalesce(e.joins, 0) as joins, coalesce(e.leaves, 0) as leaves, coalesce(e.mod_actions, 0) as mod_actions
          from days d left join act a on a.day = d.day left join ev e on e.day = d.day
          order by d.day
        `),
      );
      const [totals] = rowsOf<Record<string, number>>(
        await db.execute(dsql`
          select coalesce(sum(messages), 0)::int as messages, coalesce(sum(voice_seconds), 0)::bigint as voice_seconds,
                 count(distinct user_id) filter (where messages > 0 or voice_seconds > 0)::int as active_users
          from activity_daily where guild_id = ${gid} and day between ${from}::date and ${to}::date
        `),
      );
      const heatmap = rowsOf<Record<string, number>>(
        await db.execute(dsql`
          select extract(isodow from day)::int as dow, hour, sum(messages)::int as messages, sum(voice_seconds)::int as voice_seconds
          from activity_hourly where guild_id = ${gid} and day between ${from}::date and ${to}::date
          group by 1, 2
        `),
      );
      const topMembers = await memberReport(gid, { ...req.query, sort: "messages", limit: "5", status: "all" });
      const topChannels = rowsOf<Record<string, unknown>>(
        await db.execute(dsql`
          select channel_id, sum(messages)::int as messages, sum(voice_seconds)::int as voice_seconds
          from channel_daily where guild_id = ${gid} and day between ${from}::date and ${to}::date
          group by channel_id order by sum(messages) + sum(voice_seconds) / 60 desc limit 5
        `),
      );
      const g = discordGuild(gid);
      return {
        from,
        to,
        memberCount: g?.memberCount ?? null,
        totals: {
          ...totals,
          voice_seconds: Number(totals?.voice_seconds ?? 0),
          joins: series.reduce((s, d) => s + Number(d.joins), 0),
          leaves: series.reduce((s, d) => s + Number(d.leaves), 0),
          mod_actions: series.reduce((s, d) => s + Number(d.mod_actions), 0),
        },
        series,
        heatmap,
        topMembers,
        topChannels,
      };
    });

    r.get<GP & { Querystring: Record<string, string | undefined> }>("/api/guilds/:guildId/reports/members", async (req) => {
      const rows = await memberReport(req.params.guildId, req.query);
      return { total: Number(rows[0]?.total_count ?? 0), rows: rows.map(({ total_count, ...r }) => r) };
    });

    r.get<GP & { Querystring: Record<string, string | undefined> }>("/api/guilds/:guildId/reports/members.csv", async (req, reply) => {
      const rows = await memberReport(req.params.guildId, { ...req.query, limit: "5000", page: "0" });
      const { from, to } = period(req.query);
      const lang = isLang(req.query.lang) ? req.query.lang : "en";
      const col = (k: string) => t(lang, `dash.members.csv.${k}`);
      const csv = toCsv(
        rows,
        (["user_id", "display_name", "username", "messages", "voice_seconds", "reactions", "commands", "active_days", "xp", "last_seen", "joined_at", "left_at"] as const).map(
          (k) => [k, col(k)] as [string, string],
        ),
      );
      reply.header("Content-Type", "text/csv; charset=utf-8");
      reply.header("Content-Disposition", `attachment; filename="activity_${from}_${to}.csv"`);
      return "﻿" + csv; // BOM so Excel opens åäö correctly
    });

    r.get<GP & Q>("/api/guilds/:guildId/reports/channels", async (req) => {
      const { from, to } = period(req.query);
      return rowsOf(
        await db.execute(dsql`
          select channel_id, sum(messages)::int as messages, sum(voice_seconds)::int as voice_seconds,
                 count(*) filter (where messages > 0 or voice_seconds > 0)::int as active_days
          from channel_daily where guild_id = ${req.params.guildId} and day between ${from}::date and ${to}::date
          group by channel_id order by messages desc, voice_seconds desc
        `),
      );
    });

    r.get<GP & Q & { Params: { userId: string } }>("/api/guilds/:guildId/reports/members/:userId", async (req) => {
      const { guildId, userId } = req.params;
      const { from, to } = period(req.query);
      const [member] = rowsOf<Record<string, unknown>>(
        await db.execute(dsql`select * from members where guild_id = ${guildId} and user_id = ${userId}`),
      );
      const [level] = rowsOf<{ xp: string; message_count: number }>(
        await db.execute(dsql`select xp, message_count from member_levels where guild_id = ${guildId} and user_id = ${userId}`),
      );
      const series = rowsOf(
        await db.execute(dsql`
          select to_char(d.day, 'YYYY-MM-DD') as day, coalesce(a.messages, 0) as messages,
                 coalesce(a.voice_seconds, 0) as voice_seconds, coalesce(a.reactions, 0) as reactions
          from generate_series(${from}::date, ${to}::date, interval '1 day') d(day)
          left join activity_daily a on a.guild_id = ${guildId} and a.user_id = ${userId} and a.day = d.day::date
          order by d.day
        `),
      );
      const events = rowsOf(
        await db.execute(dsql`
          select id, type, channel_id, data, created_at from events
          where guild_id = ${guildId} and user_id = ${userId} order by created_at desc limit 100
        `),
      );
      const cases = rowsOf(
        await db.execute(dsql`
          select case_number, action, reason, moderator_tag, created_at from mod_cases
          where guild_id = ${guildId} and user_id = ${userId} order by created_at desc
        `),
      );
      const g = discordGuild(guildId);
      const live = g ? await g.members.fetch(userId).catch(() => null) : null;
      return {
        member: member ?? { user_id: userId },
        roles: live ? live.roles.cache.filter((r) => r.id !== guildId).map((r) => ({ id: r.id, name: r.name, color: r.hexColor })) : [],
        level: level ? { xp: Number(level.xp), messageCount: level.message_count, ...levelFromXp(Number(level.xp)) } : null,
        series,
        events,
        cases,
      };
    });

    r.get<GP & { Querystring: { type?: string; limit?: string; before?: string } }>("/api/guilds/:guildId/reports/events", async (req) => {
      const type = req.query.type ?? "";
      const limit = Math.min(Number(req.query.limit ?? 100) || 100, 500);
      const before = Number(req.query.before ?? 0);
      return rowsOf(
        await db.execute(dsql`
          select e.id, e.type, e.user_id, e.channel_id, e.data, e.created_at,
                 coalesce(nullif(m.display_name, ''), m.username) as display_name, m.avatar
          from events e left join members m on m.guild_id = e.guild_id and m.user_id = e.user_id
          where e.guild_id = ${req.params.guildId}
            and (${type} = '' or e.type = ${type})
            and (${before} = 0 or e.id < ${before})
          order by e.id desc limit ${limit}
        `),
      );
    });
  });
}
