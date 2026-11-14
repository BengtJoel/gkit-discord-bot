import { Events, MessageFlags, type Client, type Guild, type MessageReaction, type PartialMessageReaction, type User, type PartialUser } from "discord.js";
import { Cron } from "croner";
import { eq, sql as dsql } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { log } from "../lib/log.js";
import { bus } from "../core/events.js";
import { registerJobHandler } from "../core/jobs.js";
import { removeRoles } from "../core/actions.js";
import { userT } from "../i18n/index.js";
import { automationsEnabled, dispatch, rulesFor, runActions, runRule, takeCause, invalidateRules, rowToRule, type TriggerContext } from "./engine.js";
import type { Rule } from "./types.js";

/* ---------------- Schedules ("every Wednesday 18:45") ---------------- */

const crons = new Map<number, Cron>();

export function scheduleRule(rule: Rule, client: Client) {
  crons.get(rule.id)?.stop();
  crons.delete(rule.id);
  if (!rule.enabled || rule.trigger.type !== "schedule") return;
  try {
    const job = new Cron(rule.trigger.cron, { timezone: rule.trigger.timezone, protect: true }, async () => {
      const guild = client.guilds.cache.get(rule.guildId);
      if (!guild) return;
      // Re-read the rule so edits made since scheduling are respected
      const fresh = (await rulesFor(rule.guildId)).find((r) => r.id === rule.id);
      if (!fresh?.enabled || !(await automationsEnabled(guild.id))) return;
      await runRule(fresh, { guild });
    });
    crons.set(rule.id, job);
  } catch (err) {
    log.warn({ err, rule: rule.id }, "invalid automation schedule");
  }
}

export function unscheduleRule(id: number) {
  crons.get(id)?.stop();
  crons.delete(id);
}

/* ---------------- Inactivity ("no activity in 30 days") ---------------- */

/**
 * Once a day: for each inactive-trigger rule, find members whose last message/voice is older
 * than N days. A member triggers once per inactive period — becoming active again re-arms it.
 */
export async function scanInactive(client: Client) {
  const rows = await db.select().from(schema.automations).where(eq(schema.automations.enabled, true));
  for (const row of rows) {
    const rule = rowToRule(row);
    if (!rule || rule.trigger.type !== "inactive") continue;
    const guild = client.guilds.cache.get(rule.guildId);
    if (!guild || !(await automationsEnabled(guild.id))) continue;
    const key = `__inactive_${rule.id}`;
    const candidates = (await db.execute(dsql`
      select m.user_id from members m
      left join member_counters c on c.guild_id = m.guild_id and c.user_id = m.user_id and c.key = ${key}
      where m.guild_id = ${rule.guildId} and m.left_at is null and not m.bot
        and coalesce(greatest(m.last_message_at, m.last_voice_at), m.joined_at) < now() - make_interval(days => ${rule.trigger.days})
        and (c.value is null or to_timestamp(c.value) < coalesce(greatest(m.last_message_at, m.last_voice_at), m.joined_at))
      limit 50
    `)) as unknown as { user_id: string }[];
    for (const { user_id } of candidates) {
      const member = await guild.members.fetch(user_id).catch(() => null);
      const t = schema.memberCounters;
      await db
        .insert(t)
        .values({ guildId: rule.guildId, userId: user_id, key, value: Math.floor(Date.now() / 1000) })
        .onConflictDoUpdate({ target: [t.guildId, t.userId, t.key], set: { value: Math.floor(Date.now() / 1000), updatedAt: new Date() } });
      if (member) await runRule(rule, { guild, member, userId: member.id });
    }
  }
}

/* ---------------- Wiring ---------------- */

export async function loadSchedules(client: Client) {
  const rows = await db.select().from(schema.automations).where(eq(schema.automations.enabled, true));
  for (const row of rows) {
    const rule = rowToRule(row);
    if (rule) scheduleRule(rule, client);
  }
}

export function onRulesChanged(guildId: string, client: Client, changed?: Rule | null, deletedId?: number) {
  invalidateRules(guildId);
  if (deletedId) unscheduleRule(deletedId);
  if (changed) scheduleRule(changed, client);
}

const safe =
  <A extends unknown[]>(name: string, fn: (...a: A) => Promise<unknown>) =>
  (...a: A) =>
    void fn(...a).catch((err) => log.warn({ err, trigger: name }, "automation trigger failed"));

export function registerAutomations(client: Client) {
  const parentOf = (guild: Guild, channelId: string | null) => {
    const ch = channelId ? guild.channels.cache.get(channelId) : null;
    return ch && "parentId" in ch ? ch.parentId : null;
  };

  client.on(
    Events.MessageCreate,
    safe("message_sent", async (msg) => {
      if (!msg.inGuild() || msg.author.bot || msg.webhookId) return;
      await dispatch(
        "message_sent",
        { guild: msg.guild, member: msg.member, userId: msg.author.id, channelId: msg.channelId, message: msg },
        { parentId: parentOf(msg.guild, msg.channelId) },
      );
    }),
  );

  client.on(Events.GuildMemberAdd, safe("member_joined", async (m) => void (await dispatch("member_joined", { guild: m.guild, member: m, userId: m.id }))));
  client.on(Events.GuildMemberRemove, safe("member_left", async (m) => void (await dispatch("member_left", { guild: m.guild, userId: m.id }))));

  bus.on("member.roleAdded", (m, role) =>
    dispatch("role_added", { guild: m.guild, member: m, userId: m.id, roleId: role.id, depth: takeCause(m.guild.id, m.id, role.id, "added") }),
  );
  bus.on("member.roleRemoved", (m, role) =>
    dispatch("role_removed", { guild: m.guild, member: m, userId: m.id, roleId: role.id, depth: takeCause(m.guild.id, m.id, role.id, "removed") }),
  );
  bus.on("level.reached", (m, level) => dispatch("level_reached", { guild: m.guild, member: m, userId: m.id, level }));

  const onReaction =
    (type: "reaction_added" | "reaction_removed") =>
    async (reaction: MessageReaction | PartialMessageReaction, user: User | PartialUser) => {
      if (user.bot || !reaction.message.guild) return;
      const guild = reaction.message.guild;
      const member = await guild.members.fetch(user.id).catch(() => null);
      const emoji = reaction.emoji.id ? `<:${reaction.emoji.name}:${reaction.emoji.id}>` : (reaction.emoji.name ?? "");
      await dispatch(type, { guild, member, userId: user.id, channelId: reaction.message.channelId, messageId: reaction.message.id, emoji });
    };
  client.on(Events.MessageReactionAdd, safe("reaction_added", onReaction("reaction_added")));
  client.on(Events.MessageReactionRemove, safe("reaction_removed", onReaction("reaction_removed")));

  client.on(
    Events.VoiceStateUpdate,
    safe("voice", async (oldS, newS) => {
      if (oldS.channelId === newS.channelId) return;
      const member = newS.member ?? oldS.member;
      if (!member || member.user.bot) return;
      if (oldS.channelId)
        await dispatch("voice_left", { guild: oldS.guild, member, userId: member.id, channelId: oldS.channelId }, { parentId: parentOf(oldS.guild, oldS.channelId) });
      if (newS.channelId)
        await dispatch("voice_joined", { guild: newS.guild, member, userId: member.id, channelId: newS.channelId }, { parentId: parentOf(newS.guild, newS.channelId) });
    }),
  );

  /* Buttons and menus sent by automations: gk:a:<key> / gk:s:<key> */
  client.on(
    Events.InteractionCreate,
    safe("component", async (i) => {
      if (!i.inCachedGuild()) return;
      if (!(i.isButton() || i.isStringSelectMenu())) return;
      const [ns, kind, ...rest] = i.customId.split(":");
      if (ns !== "gk" || (kind !== "a" && kind !== "s")) return;
      const key = rest.join(":");
      await i.deferUpdate(); // acknowledge within Discord's 3s; replies are sent as follow-ups
      const { ran } = await dispatch(
        kind === "a" ? "button_clicked" : "select_chosen",
        {
          guild: i.guild,
          member: i.member,
          userId: i.user.id,
          channelId: i.channelId,
          interaction: i,
          values: i.isStringSelectMenu() ? i.values : [],
          message: null,
        },
        { key },
      );
      if (!ran) await i.followUp({ content: userT(i)("automations.nothingHappened"), flags: MessageFlags.Ephemeral }).catch(() => {});
    }),
  );

  /* Jobs */
  registerJobHandler("automation.removeRoles", async (p) => {
    const guild = client.guilds.cache.get(String(p.guildId));
    const member = guild ? await guild.members.fetch(String(p.userId)).catch(() => null) : null;
    if (!member) return; // left the server — nothing to remove
    await removeRoles(member, p.roleIds as string[], { source: `automation:${p.ruleId}`, reason: "Temporary role expired" });
  });

  registerJobHandler("automation.resume", async (p) => {
    const guild = client.guilds.cache.get(String(p.guildId));
    if (!guild) return;
    const rule = (await rulesFor(guild.id)).find((r) => r.id === Number(p.ruleId));
    if (!rule?.enabled) return; // rule was turned off or deleted while waiting
    const userId = (p.userId as string | null) ?? null;
    const member = userId ? await guild.members.fetch(userId).catch(() => null) : null;
    const channel = p.channelId ? guild.channels.cache.get(String(p.channelId)) : null;
    const message =
      p.messageId && channel?.isTextBased() ? await channel.messages.fetch(String(p.messageId)).catch(() => null) : null;
    await runActions(
      rule,
      {
        guild,
        member,
        userId,
        channelId: (p.channelId as string | null) ?? null,
        message,
        roleId: (p.roleId as string | null) ?? null,
        level: (p.level as number | null) ?? null,
        values: (p.values as string[]) ?? [],
        command: (p.command as string | null) ?? null,
        depth: Number(p.depth ?? 0),
      },
      Number(p.from),
    );
  });

  client.once(Events.ClientReady, async (c) => {
    await loadSchedules(c);
    // Inactivity check once a day at 04:17 Swedish time, plus once shortly after start
    new Cron("17 4 * * *", { timezone: "Europe/Stockholm", protect: true }, () => void scanInactive(c).catch((err) => log.warn({ err }, "inactive scan failed")));
    setTimeout(() => void scanInactive(c).catch(() => {}), 60_000).unref();
  });
}

/** Called when a custom slash command is used */
export async function dispatchCommandUsed(ctx: TriggerContext, command: string) {
  await dispatch("command_used", { ...ctx, command }, { command });
}

/** Prune run log: keep 30 days */
export async function pruneAutomationRuns() {
  await db.execute(dsql`delete from automation_runs where created_at < now() - interval '30 days'`);
}
