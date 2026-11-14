import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  Events,
  MessageFlags,
  StringSelectMenuBuilder,
  type ButtonInteraction,
  type Client,
  type MessageReaction,
  type PartialMessageReaction,
  type StringSelectMenuInteraction,
  type User,
  type PartialUser,
} from "discord.js";
import { eq } from "drizzle-orm";
import { db, schema } from "../../db/index.js";
import { enabledConfig } from "../../settings.js";
import { log } from "../../lib/log.js";
import { guildT, userT } from "../../i18n/index.js";
import { addRoles, removeRoles } from "../../core/actions.js";

/**
 * Reaction roles in three flavours:
 *  - reactions: classic emoji reactions (also works on messages MEE6 posted)
 *  - buttons:   one button per role, click to toggle
 *  - select:    a dropdown menu with all roles
 * Modes: normal (toggle freely), unique (one role at a time), verify (add only, never removed).
 */
export type RRType = "reactions" | "buttons" | "select";
export type RREntry = { emoji: string; roleId: string; label?: string; style?: "primary" | "secondary" | "success" | "danger" };
type RRMessage = typeof schema.reactionRoleMessages.$inferSelect;

/** "<:name:123>" / "<a:name:123>" / "123" -> "123"; unicode emoji unchanged */
export function emojiKey(e: string) {
  const m = e.match(/<a?:\w+:(\d+)>/) ?? e.match(/^(\d{15,22})$/);
  return m ? m[1] : e.trim();
}

const rrError = (code: string) => Object.assign(new Error(code), { code });

const byMessage = new Map<string, RRMessage>();
const byId = new Map<number, RRMessage>();

export async function loadReactionRoles() {
  byMessage.clear();
  byId.clear();
  const rows = await db.select().from(schema.reactionRoleMessages);
  for (const r of rows) {
    byId.set(r.id, r);
    if (r.messageId) byMessage.set(r.messageId, r);
  }
}

function buildEmbed(row: RRMessage, defaultTitle: string) {
  const entries = row.entries as RREntry[];
  // Buttons and menus show the roles themselves; reactions need the legend in the text
  const lines = row.type === "reactions" ? entries.map((e) => `${e.emoji} — <@&${e.roleId}>${e.label ? ` · ${e.label}` : ""}`) : [];
  return new EmbedBuilder()
    .setColor(parseInt(row.color.replace("#", ""), 16) || 0x8b5cf6)
    .setTitle(row.title || defaultTitle)
    .setDescription([row.description, "", ...lines].filter((s, i) => s || i > 0).join("\n").trim() || null);
}

const styles = { primary: ButtonStyle.Primary, secondary: ButtonStyle.Secondary, success: ButtonStyle.Success, danger: ButtonStyle.Danger };

function buildComponents(row: RRMessage, roleName: (id: string) => string, placeholder: string) {
  const entries = row.entries as RREntry[];
  if (row.type === "buttons") {
    const rows: ActionRowBuilder<ButtonBuilder>[] = [];
    entries.forEach((e, i) => {
      if (i % 5 === 0) rows.push(new ActionRowBuilder<ButtonBuilder>());
      const b = new ButtonBuilder()
        .setCustomId(`gk:rr:${row.id}:${i}`)
        .setLabel((e.label || roleName(e.roleId)).slice(0, 80))
        .setStyle(styles[e.style ?? "secondary"]);
      if (e.emoji) b.setEmoji(e.emoji);
      rows.at(-1)!.addComponents(b);
    });
    return rows;
  }
  if (row.type === "select") {
    const menu = new StringSelectMenuBuilder()
      .setCustomId(`gk:rr:${row.id}:select`)
      .setPlaceholder(placeholder)
      .setMinValues(0)
      .setMaxValues(row.mode === "unique" ? 1 : entries.length)
      .addOptions(
        entries.map((e, i) => ({
          label: (e.label || roleName(e.roleId)).slice(0, 100),
          value: String(i),
          ...(e.emoji ? { emoji: e.emoji } : {}),
        })),
      );
    return [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)];
  }
  return [];
}

/** Posts (or edits, if already posted) the message and makes sure all reactions/components are present. */
export async function publishReactionRoles(client: Client, id: number) {
  const [row] = await db.select().from(schema.reactionRoleMessages).where(eq(schema.reactionRoleMessages.id, id));
  if (!row) throw rrError("errors.messageNotFound");
  const channel = await client.channels.fetch(row.channelId);
  if (!channel?.isTextBased() || !("send" in channel) || !("guild" in channel)) throw rrError("errors.botCannotWrite");

  let message = row.messageId ? await channel.messages.fetch(row.messageId).catch(() => null) : null;
  const ours = !!message && message.author.id === client.user?.id;
  // Buttons and menus can only be put on the bot's own messages
  if (message && !ours && row.type !== "reactions") throw rrError("errors.rrForeignMessage");

  const tr = await guildT(channel.guild);
  const roleName = (rid: string) => channel.guild.roles.cache.get(rid)?.name ?? "role";
  const payload = {
    embeds: [buildEmbed(row, tr("defaults.reactionRolesTitle"))],
    components: buildComponents(row, roleName, tr("reactionRoles.selectPlaceholder")),
  };
  if (message && ours) await message.edit(payload);
  else if (!message) message = await channel.send(payload);
  // A message someone else posted (e.g. MEE6) is kept as-is; we only add reactions to it.

  if (row.type === "reactions") {
    for (const e of row.entries as RREntry[]) {
      const has = message.reactions.cache.some((r) => (r.emoji.id ?? r.emoji.name) === emojiKey(e.emoji) && r.me);
      if (!has) await message.react(e.emoji).catch((err) => log.warn({ err, emoji: e.emoji }, "react failed"));
    }
  } else if (ours) {
    // switching from reactions to buttons/menu: remove the bot's old reactions
    for (const r of message.reactions.cache.values()) if (r.me) await r.users.remove(client.user!.id).catch(() => {});
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

async function handleReaction(reaction: MessageReaction | PartialMessageReaction, user: User | PartialUser, added: boolean) {
  if (user.bot) return;
  const row = byMessage.get(reaction.message.id);
  if (!row || row.type !== "reactions") return;
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

/** Decides which roles to add/remove for a button click or menu choice. Pure, so it's unit tested. */
export function planRoleChange(mode: string, entryRoleIds: string[], has: (id: string) => boolean, chosen: string[], kind: "button" | "select") {
  const add: string[] = [];
  const remove: string[] = [];
  if (kind === "button") {
    const roleId = chosen[0];
    if (has(roleId)) {
      if (mode !== "verify") remove.push(roleId);
    } else {
      add.push(roleId);
      if (mode === "unique") remove.push(...entryRoleIds.filter((id) => id !== roleId && has(id)));
    }
  } else {
    const picked = new Set(mode === "unique" ? chosen.slice(0, 1) : chosen);
    for (const id of entryRoleIds) {
      if (picked.has(id) && !has(id)) add.push(id);
      if (!picked.has(id) && has(id) && mode !== "verify") remove.push(id);
    }
  }
  return { add: [...new Set(add)], remove: [...new Set(remove)] };
}

async function handleComponent(i: ButtonInteraction<"cached"> | StringSelectMenuInteraction<"cached">) {
  const [, , idPart, which] = i.customId.split(":");
  const row = byId.get(Number(idPart));
  const tu = userT(i);
  if (!row || !(await enabledConfig(i.guildId, "reactionRoles"))) {
    return i.reply({ content: tu("common.moduleDisabled"), flags: MessageFlags.Ephemeral });
  }
  const entries = row.entries as RREntry[];
  const chosen = i.isStringSelectMenu()
    ? i.values.map((v) => entries[Number(v)]?.roleId).filter(Boolean)
    : [entries[Number(which)]?.roleId].filter(Boolean);
  if (!chosen.length && i.isButton()) return i.reply({ content: tu("errors.notFound"), flags: MessageFlags.Ephemeral });

  const member = i.member;
  const plan = planRoleChange(row.mode, entries.map((e) => e.roleId), (id) => member.roles.cache.has(id), chosen, i.isButton() ? "button" : "select");
  const tr = await guildT(i.guild);
  const ctx = { source: "reactionRoles", reason: tr(row.mode === "unique" ? "reactionRoles.reasonUnique" : "reactionRoles.reason") };
  const r1 = plan.remove.length ? await removeRoles(member, plan.remove, ctx) : { ok: true };
  const r2 = plan.add.length ? await addRoles(member, plan.add, ctx) : { ok: true };

  const names = (ids: string[]) => ids.map((id) => `<@&${id}>`).join(", ");
  const lines: string[] = [];
  if (plan.add.length) lines.push(tu("reactionRoles.added", { roles: names(plan.add) }));
  if (plan.remove.length) lines.push(tu("reactionRoles.removed", { roles: names(plan.remove) }));
  if (!lines.length) lines.push(tu("reactionRoles.noChange"));
  if (!r1.ok || !r2.ok) lines.push(tu("reactionRoles.failed"));
  return i.reply({ content: lines.join("\n"), flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
}

export function registerReactionRoles(client: Client) {
  client.on(Events.MessageReactionAdd, (r, u) => void handleReaction(r, u, true).catch((err) => log.warn({ err }, "rr add")));
  client.on(Events.MessageReactionRemove, (r, u) => void handleReaction(r, u, false).catch((err) => log.warn({ err }, "rr remove")));
  client.on(Events.InteractionCreate, (i) => {
    if (!i.inCachedGuild() || !(i.isButton() || i.isStringSelectMenu()) || !i.customId.startsWith("gk:rr:")) return;
    handleComponent(i).catch((err) => log.warn({ err }, "rr component failed"));
  });
  client.on(Events.MessageDelete, async (m) => {
    if (byMessage.has(m.id)) {
      await db.update(schema.reactionRoleMessages).set({ messageId: null }).where(eq(schema.reactionRoleMessages.messageId, m.id));
      byMessage.delete(m.id);
    }
  });
}
