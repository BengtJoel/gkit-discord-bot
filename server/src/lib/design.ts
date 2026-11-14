import { AttachmentBuilder, EmbedBuilder, type Guild, type GuildMember, type MessageCreateOptions, type User } from "discord.js";
import { and, eq } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { renderTemplate } from "./template.js";
import { fetchImage, renderCard } from "./card.js";
import { guildT } from "../i18n/index.js";

/**
 * A designed message: text, an optional embed and an optional banner image.
 * Shared by welcome messages and the embed message builder.
 */

export { embedSchema, cardSchema, imageSchema, designFields, designSchema, type Design } from "./designSchema.js";
import type { Design } from "./designSchema.js";

export interface DesignContext {
  guild: Guild;
  member?: GuildMember | null;
  user?: User | null;
  /** Used when the message text is empty (e.g. the localized default welcome text) */
  fallbackText?: string;
  brandColor: number;
}

const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" };

export async function loadMedia(guildId: string, id: number) {
  const [row] = await db
    .select()
    .from(schema.media)
    .where(and(eq(schema.media.id, id), eq(schema.media.guildId, guildId)));
  return row ?? null;
}

/** Renders a design into something channel.send / user.send / message.edit accept */
export async function buildDesigned(d: Design, ctx: DesignContext): Promise<MessageCreateOptions> {
  const tctx = { guild: ctx.guild, member: ctx.member ?? undefined, user: ctx.user ?? undefined };
  const render = (s: string) => renderTemplate(s, tctx);
  const payload: MessageCreateOptions = { allowedMentions: { parse: ["users", "roles"] } };
  const files: AttachmentBuilder[] = [];

  let imageUrl: string | null = null;
  const cardUser = ctx.member?.user ?? ctx.user ?? null;
  const card = d.image.card.enabled && cardUser ? await renderWelcomeCard(d.image, ctx) : null;
  if (card) {
    files.push(new AttachmentBuilder(card, { name: "welcome.png" }));
    imageUrl = "attachment://welcome.png";
  } else if (d.image.mediaId) {
    const m = await loadMedia(ctx.guild.id, d.image.mediaId);
    if (m) {
      const name = `banner.${EXT[m.mime] ?? "png"}`;
      files.push(new AttachmentBuilder(m.data, { name }));
      imageUrl = `attachment://${name}`;
    }
  } else if (d.image.url) imageUrl = d.image.url;

  const text = d.message || (!d.embed.enabled ? (ctx.fallbackText ?? "") : "");
  if (text) payload.content = render(text).slice(0, 2000);

  const e = d.embed;
  if (e.enabled) {
    const embed = new EmbedBuilder().setColor(e.color ? parseInt(e.color.slice(1), 16) : ctx.brandColor);
    const user = ctx.member?.user ?? ctx.user ?? null;
    const memberName = ctx.member?.displayName ?? user?.globalName ?? user?.username ?? "";
    const desc = e.description || (!d.message ? (ctx.fallbackText ?? "") : "");
    if (e.title) embed.setTitle(render(e.title).slice(0, 256));
    if (e.url) embed.setURL(e.url);
    if (desc) embed.setDescription(render(desc).slice(0, 4096));
    if (e.author === "member" && user) embed.setAuthor({ name: memberName.slice(0, 256), iconURL: user.displayAvatarURL({ size: 128 }) });
    if (e.author === "server") embed.setAuthor({ name: ctx.guild.name.slice(0, 256), iconURL: ctx.guild.iconURL({ size: 128 }) ?? undefined });
    const thumb = e.thumbnail === "member" ? user?.displayAvatarURL({ size: 256 }) : e.thumbnail === "server" ? ctx.guild.iconURL({ size: 256 }) : null;
    if (thumb) embed.setThumbnail(thumb);
    if (e.fields.length) embed.addFields(e.fields.map((f) => ({ name: render(f.name).slice(0, 256), value: render(f.value).slice(0, 1024), inline: f.inline })));
    if (e.footer) embed.setFooter({ text: render(e.footer).slice(0, 2048) });
    if (e.timestamp) embed.setTimestamp(new Date());
    if (imageUrl) embed.setImage(imageUrl);
    // Discord rejects an embed with nothing in it
    if (!embed.data.title && !embed.data.description && !embed.data.fields?.length && !embed.data.image && !embed.data.author) embed.setDescription("​");
    payload.embeds = [embed];
  } else if (imageUrl && !files.length) {
    // A plain link is shown as a preview when it's alone or after the text
    payload.content = [payload.content, imageUrl].filter(Boolean).join("\n").slice(0, 2000);
  }
  if (files.length) payload.files = files;
  if (!payload.content && !payload.embeds && !payload.files) payload.content = "​";
  return payload;
}

/** True when the design will produce something visible (used to skip sending empty welcome messages) */
export const hasContent = (d: Design, fallback = "") =>
  !!(d.message || fallback || (d.embed.enabled && (d.embed.title || d.embed.description || d.embed.fields.length)) || d.image.mediaId || d.image.url);

/**
 * Renders the welcome card for a member. Exported for the dashboard preview.
 * {user} becomes the display name, since a mention can't be drawn.
 */
export async function renderWelcomeCard(image: Design["image"], ctx: DesignContext): Promise<Buffer | null> {
  const user = ctx.member?.user ?? ctx.user ?? null;
  if (!user) return null;
  const tr = await guildT(ctx.guild);
  const c = image.card;
  const tctx = { guild: ctx.guild, member: ctx.member ?? undefined, user };
  const text = (s: string) => renderTemplate(s.replace(/\{user(\.mention)?\}/g, "{displayname}"), tctx).trim();
  let background: Buffer | null = null;
  let key: string | undefined;
  if (image.mediaId) {
    const m = await loadMedia(ctx.guild.id, image.mediaId);
    if (m) {
      background = m.data;
      key = `m${m.id}`;
    }
  } else if (image.url) {
    background = await fetchImage(image.url);
    key = image.url;
  }
  const avatar = await fetchImage(user.displayAvatarURL({ extension: "png", size: 256, forceStatic: true }));
  try {
    return await renderCard(
      {
        background,
        avatar,
        initial: ctx.member?.displayName ?? user.username,
        title: text(c.title || tr("defaults.cardTitle")),
        subtitle: text(c.subtitle || tr("defaults.cardSubtitle")),
        style: {
          layout: c.layout,
          textColor: c.textColor,
          overlay: c.overlay,
          accentColor: c.accentColor ?? `#${ctx.brandColor.toString(16).padStart(6, "0")}`,
        },
      },
      key,
    );
  } catch {
    return null;
  }
}
