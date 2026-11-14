import { AttachmentBuilder, EmbedBuilder, type Guild, type GuildMember, type MessageCreateOptions, type User } from "discord.js";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { renderTemplate } from "./template.js";

/**
 * A designed message: text, an optional embed and an optional banner image.
 * Shared by welcome messages and the embed message builder.
 */

const hex = z.string().regex(/^#[0-9a-f]{6}$/i);
const httpUrl = z.union([z.literal(""), z.url({ protocol: /^https?$/ }).max(2000)]);

export const embedSchema = z
  .object({
    enabled: z.boolean().default(false),
    title: z.string().max(256).default(""),
    url: httpUrl.default(""),
    description: z.string().max(4000).default(""),
    /** null = the server's brand colour */
    color: hex.nullable().default(null),
    /** Small line above the title */
    author: z.enum(["none", "member", "server"]).default("none"),
    /** Small picture top-right */
    thumbnail: z.enum(["none", "member", "server"]).default("none"),
    fields: z
      .array(z.object({ name: z.string().min(1).max(256), value: z.string().min(1).max(1024), inline: z.boolean().default(false) }))
      .max(25)
      .default([]),
    footer: z.string().max(2048).default(""),
    timestamp: z.boolean().default(false),
  })
  .prefault({});

/** Uploaded image (mediaId) or a link to one. Inside an embed it becomes the embed's big image. */
export const imageSchema = z
  .object({
    mediaId: z.number().int().positive().nullable().default(null),
    url: httpUrl.default(""),
  })
  .prefault({});

export const designFields = {
  message: z.string().max(2000).default(""),
  embed: embedSchema,
  image: imageSchema,
};
export const designSchema = z.object(designFields);
export type Design = z.infer<typeof designSchema>;

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
  if (d.image.mediaId) {
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
