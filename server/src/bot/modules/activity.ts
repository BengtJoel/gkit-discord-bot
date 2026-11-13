import { Events, type Client, type GuildMember, type PartialGuildMember } from "discord.js";
import { sql as dsql } from "drizzle-orm";
import { db, schema } from "../../db/index.js";
import { enabledConfig } from "../../settings.js";
import { dayKey } from "../../lib/template.js";
import { log } from "../../lib/log.js";

/**
 * Activity tracking for reports. Counters are buffered in memory and flushed
 * every FLUSH_MS so a busy server doesn't do one DB write per message.
 */
const FLUSH_MS = 30_000;

type UserCounters = { messages: number; voiceSeconds: number; reactions: number; commands: number };
const userBuf = new Map<string, UserCounters>(); // guild|user|day
const chanBuf = new Map<string, { messages: number; voiceSeconds: number }>(); // guild|channel|day
const hourBuf = new Map<string, { messages: number; voiceSeconds: number }>(); // guild|day|hour
const lastSeen = new Map<string, { message?: Date; voice?: Date }>(); // guild|user

/** Open voice sessions: guild|user -> channel + last time we accounted seconds */
const voice = new Map<string, { channelId: string; since: number }>();

function bumpUser(guildId: string, userId: string, field: keyof UserCounters, n = 1) {
  const k = `${guildId}|${userId}|${dayKey()}`;
  const c = userBuf.get(k) ?? { messages: 0, voiceSeconds: 0, reactions: 0, commands: 0 };
  c[field] += n;
  userBuf.set(k, c);
}
function bumpChannel(guildId: string, channelId: string, field: "messages" | "voiceSeconds", n = 1) {
  const k = `${guildId}|${channelId}|${dayKey()}`;
  const c = chanBuf.get(k) ?? { messages: 0, voiceSeconds: 0 };
  c[field] += n;
  chanBuf.set(k, c);
}
function stockholmHour(d = new Date()) {
  return Number(d.toLocaleString("sv-SE", { timeZone: "Europe/Stockholm", hour: "2-digit", hourCycle: "h23" }));
}
function bumpHour(guildId: string, field: "messages" | "voiceSeconds", n = 1) {
  const k = `${guildId}|${dayKey()}|${stockholmHour()}`;
  const c = hourBuf.get(k) ?? { messages: 0, voiceSeconds: 0 };
  c[field] += n;
  hourBuf.set(k, c);
}
function seen(guildId: string, userId: string, kind: "message" | "voice") {
  const k = `${guildId}|${userId}`;
  const s = lastSeen.get(k) ?? {};
  s[kind] = new Date();
  lastSeen.set(k, s);
}

export function trackCommand(guildId: string, userId: string) {
  bumpUser(guildId, userId, "commands");
}

export async function recordEvent(
  guildId: string,
  type: string,
  opts: { userId?: string | null; channelId?: string | null; data?: Record<string, unknown> } = {},
) {
  try {
    await db.insert(schema.events).values({
      guildId,
      type,
      userId: opts.userId ?? null,
      channelId: opts.channelId ?? null,
      data: opts.data ?? {},
    });
  } catch (err) {
    log.warn({ err }, "recordEvent failed");
  }
}

export async function upsertMember(m: GuildMember | PartialGuildMember, left = false) {
  if (!m.user) return;
  await db
    .insert(schema.members)
    .values({
      guildId: m.guild.id,
      userId: m.id,
      username: m.user.username,
      displayName: m.displayName ?? m.user.username,
      avatar: m.user.avatar,
      bot: m.user.bot,
      joinedAt: m.joinedAt ?? null,
      leftAt: left ? new Date() : null,
    })
    .onConflictDoUpdate({
      target: [schema.members.guildId, schema.members.userId],
      set: {
        username: m.user.username,
        displayName: m.displayName ?? m.user.username,
        avatar: m.user.avatar,
        ...(m.joinedAt ? { joinedAt: m.joinedAt } : {}),
        leftAt: left ? new Date() : null,
      },
    });
}

function accountVoice(now = Date.now()) {
  for (const [k, s] of voice) {
    const secs = Math.floor((now - s.since) / 1000);
    if (secs <= 0) continue;
    const [guildId, userId] = k.split("|");
    bumpUser(guildId, userId, "voiceSeconds", secs);
    bumpChannel(guildId, s.channelId, "voiceSeconds", secs);
    bumpHour(guildId, "voiceSeconds", secs);
    seen(guildId, userId, "voice");
    s.since += secs * 1000;
  }
}

export async function flushActivity() {
  accountVoice();
  const users = [...userBuf.entries()];
  const chans = [...chanBuf.entries()];
  const seenRows = [...lastSeen.entries()];
  const hours = [...hourBuf.entries()];
  hourBuf.clear();
  userBuf.clear();
  chanBuf.clear();
  lastSeen.clear();
  try {
    if (users.length) {
      const t = schema.activityDaily;
      await db
        .insert(t)
        .values(
          users.map(([k, c]) => {
            const [guildId, userId, day] = k.split("|");
            return { guildId, userId, day, ...c };
          }),
        )
        .onConflictDoUpdate({
          target: [t.guildId, t.userId, t.day],
          set: {
            messages: dsql`${t.messages} + excluded.messages`,
            voiceSeconds: dsql`${t.voiceSeconds} + excluded.voice_seconds`,
            reactions: dsql`${t.reactions} + excluded.reactions`,
            commands: dsql`${t.commands} + excluded.commands`,
          },
        });
    }
    if (chans.length) {
      const t = schema.channelDaily;
      await db
        .insert(t)
        .values(
          chans.map(([k, c]) => {
            const [guildId, channelId, day] = k.split("|");
            return { guildId, channelId, day, ...c };
          }),
        )
        .onConflictDoUpdate({
          target: [t.guildId, t.channelId, t.day],
          set: {
            messages: dsql`${t.messages} + excluded.messages`,
            voiceSeconds: dsql`${t.voiceSeconds} + excluded.voice_seconds`,
          },
        });
    }
    if (hours.length) {
      const t = schema.activityHourly;
      await db
        .insert(t)
        .values(
          hours.map(([k, c]) => {
            const [guildId, day, hour] = k.split("|");
            return { guildId, day, hour: Number(hour), ...c };
          }),
        )
        .onConflictDoUpdate({
          target: [t.guildId, t.day, t.hour],
          set: {
            messages: dsql`${t.messages} + excluded.messages`,
            voiceSeconds: dsql`${t.voiceSeconds} + excluded.voice_seconds`,
          },
        });
    }
    for (const [k, s] of seenRows) {
      const [guildId, userId] = k.split("|");
      const t = schema.members;
      await db
        .insert(t)
        .values({ guildId, userId, lastMessageAt: s.message ?? null, lastVoiceAt: s.voice ?? null })
        .onConflictDoUpdate({
          target: [t.guildId, t.userId],
          set: {
            ...(s.message ? { lastMessageAt: s.message } : {}),
            ...(s.voice ? { lastVoiceAt: s.voice } : {}),
          },
        });
    }
  } catch (err) {
    log.error({ err }, "Activity flush failed");
  }
}

export function registerActivity(client: Client) {
  client.on(Events.MessageCreate, async (msg) => {
    if (!msg.inGuild() || msg.author.bot) return;
    const cfg = await enabledConfig(msg.guildId, "activity");
    if (!cfg?.trackMessages || cfg.ignoredChannelIds.includes(msg.channelId)) return;
    bumpUser(msg.guildId, msg.author.id, "messages");
    bumpChannel(msg.guildId, msg.channelId, "messages");
    bumpHour(msg.guildId, "messages");
    seen(msg.guildId, msg.author.id, "message");
  });

  client.on(Events.MessageReactionAdd, async (reaction, user) => {
    const guildId = reaction.message.guildId;
    if (!guildId || user.bot) return;
    const cfg = await enabledConfig(guildId, "activity");
    if (!cfg) return;
    bumpUser(guildId, user.id, "reactions");
  });

  client.on(Events.VoiceStateUpdate, async (oldS, newS) => {
    const member = newS.member ?? oldS.member;
    if (!member || member.user.bot) return;
    const guildId = newS.guild.id;
    const k = `${guildId}|${member.id}`;
    if (oldS.channelId === newS.channelId) return; // mute/deafen etc.
    const cfg = await enabledConfig(guildId, "activity");

    // Close previous session (account its time to the old channel)
    if (voice.has(k)) {
      accountVoice();
      voice.delete(k);
    }
    if (oldS.channelId) await recordEvent(guildId, "voice_leave", { userId: member.id, channelId: oldS.channelId });

    if (newS.channelId) {
      if (cfg?.trackVoice && !cfg.ignoredChannelIds.includes(newS.channelId) && newS.channelId !== newS.guild.afkChannelId) {
        voice.set(k, { channelId: newS.channelId, since: Date.now() });
      }
      await recordEvent(guildId, "voice_join", { userId: member.id, channelId: newS.channelId });
    }
  });

  client.once(Events.ClientReady, async (c) => {
    // Resume sessions for people already sitting in voice when the bot starts
    for (const guild of c.guilds.cache.values()) {
      const cfg = await enabledConfig(guild.id, "activity");
      if (!cfg?.trackVoice) continue;
      for (const vs of guild.voiceStates.cache.values()) {
        if (vs.channelId && vs.member && !vs.member.user.bot && vs.channelId !== guild.afkChannelId) {
          voice.set(`${guild.id}|${vs.id}`, { channelId: vs.channelId, since: Date.now() });
        }
      }
    }
  });

  setInterval(() => void flushActivity(), FLUSH_MS).unref();
}
