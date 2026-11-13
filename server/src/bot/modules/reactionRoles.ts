import {
  Events,
  EmbedBuilder,
  type Client,
  type MessageReaction,
  type PartialMessageReaction,
  type User,
  type PartialUser,
} from "discord.js";
import { eq } from "drizzle-orm";
import { db, schema } from "../../db/index.js";
import { enabledConfig } from "../../settings.js";
import { log } from "../../lib/log.js";
import { guildT } from "../../i18n/index.js";
import { addRoles, removeRoles } from "../../core/actions.js";

export type RREntry = { emoji: string; roleId: string; label?: string };
type RRMessage = typeof schema.reactionRoleMessages.$inferSelect;

/** "<:name:123>" / "<a:name:123>" / "123" -> "123"; unicode emoji unchanged */
export function emojiKey(e: string) {
  const m = e.match(/<a?:\w+:(\d+)>/) ?? e.match(/^(\d{15,22})$/);
  return m ? m[1] : e.trim();
}

const byMessage = new Map<string, RRMessage>();

export async function loadReactionRoles() {
  byMessage.clear();
  const rows = await db.select().from(schema.reactionRoleMessages);
  for (const r of rows) if (r.messageId) byMessage.set(r.messageId, r);
}

function buildEmbed(row: RRMessage, defaultTitle: string) {
  const entries = row.entries as RREntry[];
  const lines = entries.map((e) => `${e.emoji} — <@&${e.roleId}>${e.label ? ` · ${e.label}` : ""}`);
  return new EmbedBuilder()
    .setColor(parseInt(row.color.replace("#", ""), 16) || 0x8b5cf6)
    .setTitle(row.title || defaultTitle)
    .setDescription([row.description, "", ...lines].filter((s, i) => s || i > 0).join("\n").trim());
}

/** Posts (or edits, if already posted) the message and makes sure all reactions are present. */
export async function publishReactionRoles(client: Client, id: number) {
  const [row] = await db.select().from(schema.reactionRoleMessages).where(eq(schema.reactionRoleMessages.id, id));
  if (!row) throw Object.assign(new Error("errors.messageNotFound"), { code: "errors.messageNotFound" });
  const channel = await client.channels.fetch(row.channelId);
  if (!channel?.isTextBased() || !("send" in channel) || !("guild" in channel)) throw Object.assign(new Error("errors.botCannotWrite"), { code: "errors.botCannotWrite" });

  let message = row.messageId ? await channel.messages.fetch(row.messageId).catch(() => null) : null;
  const tr = await guildT(channel.guild);
  const embed = buildEmbed(row, tr("defaults.reactionRolesTitle"));
  if (message && message.author.id === client.user?.id) await message.edit({ embeds: [embed] });
  else if (!message) message = await channel.send({ embeds: [embed] });
  // If message exists but wasn't sent by us (e.g. imported from MEE6) we keep it as-is and only add reactions.

  for (const e of row.entries as RREntry[]) {
    const has = message.reactions.cache.some((r) => (r.emoji.id ?? r.emoji.name) === emojiKey(e.emoji) && r.me);
    if (!has) await message.react(e.emoji).catch((err) => log.warn({ err, emoji: e.emoji }, "react failed"));
  }
  if (row.messageId !== message.id) {
    await db.update(schema.reactionRoleMessages).set({ messageId: message.id }).where(eq(schema.reactionRoleMessages.id, id));
  }
  await loadReactionRoles();
  return message.id;
}

export async function unpublishReactionRoles(client: Client, row: RRMessage) {
  if (!row.messageId) return;
  const channel = await client.channels.fetch(row.channelId).catch(() => null);
  if (channel?.isTextBased()) {
    const msg = await channel.messages.fetch(row.messageId).catch(() => null);
    if (msg && msg.author.id === client.user?.id) await msg.delete().catch(() => {});
  }
}

async function handle(
  reaction: MessageReaction | PartialMessageReaction,
  user: User | PartialUser,
  added: boolean,
) {
  if (user.bot) return;
  const row = byMessage.get(reaction.message.id);
  if (!row) return;
  const guild = reaction.message.guild;
  if (!guild || !(await enabledConfig(guild.id, "reactionRoles"))) return;
  const key = reaction.emoji.id ?? reaction.emoji.name ?? "";
  const entries = row.entries as RREntry[];
  const entry = entries.find((e) => emojiKey(e.emoji) === key);
  if (!entry) return;
  const member = await guild.members.fetch(user.id).catch(() => null);
  if (!member) return;

  const tr = await guildT(guild);
  if (added) {
    if (row.mode === "unique") {
      const others = entries.filter((e) => e !== entry && member.roles.cache.has(e.roleId)).map((e) => e.roleId);
      if (others.length) await removeRoles(member, others, { source: "reactionRoles", reason: tr("reactionRoles.reasonUnique") });
      // remove the user's other reactions on this message
      const msg = reaction.message.partial ? await reaction.message.fetch() : reaction.message;
      for (const r of msg.reactions.cache.values()) {
        if ((r.emoji.id ?? r.emoji.name) !== key) await r.users.remove(user.id).catch(() => {});
      }
    }
    await addRoles(member, [entry.roleId], { source: "reactionRoles", reason: tr("reactionRoles.reason") });
  } else if (row.mode !== "verify") {
    await removeRoles(member, [entry.roleId], { source: "reactionRoles", reason: tr("reactionRoles.reason") });
  }
}

export function registerReactionRoles(client: Client) {
  client.on(Events.MessageReactionAdd, (r, u) => void handle(r, u, true).catch((err) => log.warn({ err }, "rr add")));
  client.on(Events.MessageReactionRemove, (r, u) => void handle(r, u, false).catch((err) => log.warn({ err }, "rr remove")));
  client.on(Events.MessageDelete, async (m) => {
    if (byMessage.has(m.id)) {
      await db.update(schema.reactionRoleMessages).set({ messageId: null }).where(eq(schema.reactionRoleMessages.messageId, m.id));
      byMessage.delete(m.id);
    }
  });
}
