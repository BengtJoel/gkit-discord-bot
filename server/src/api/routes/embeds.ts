import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import type { Guild, Message } from "discord.js";
import { db, schema } from "../../db/index.js";
import { requireGuildAccess } from "../auth.js";
import { apiError } from "../errors.js";
import { audit, discordGuild, type GP } from "./guild.js";
import { brandColor } from "../../settings.js";
import { buildDesigned, designSchema, imageSchema, renderWelcomeCard, type Design } from "../../lib/design.js";
import type { GuildMember, User } from "discord.js";
import { sendToChannel } from "../../core/actions.js";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const dataUrlRe = /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/=]+)$/;
const snowflake = z.string().regex(/^\d{15,22}$/, "errors.invalidId");

type IdP = { Params: { guildId: string; id: string } };

const embedBody = z.object({
  name: z.string().max(100).default(""),
  channelId: snowflake,
  design: designSchema,
});

async function fetchOwnMessage(guild: Guild, channelId: string, messageId: string): Promise<Message | null> {
  const ch = await guild.channels.fetch(channelId).catch(() => null);
  if (!ch?.isTextBased()) return null;
  const msg = await ch.messages.fetch(messageId).catch(() => null);
  return msg && msg.author.id === guild.client.user.id ? msg : null;
}

/** Posts the message, or edits the bot's earlier message when it's still in the same channel */
async function publish(guild: Guild, row: { channelId: string; messageId: string | null; design: Design }, userId: string) {
  const payload = await buildDesigned(row.design, { guild, brandColor: await brandColor(guild.id) });
  if (row.messageId) {
    const existing = await fetchOwnMessage(guild, row.channelId, row.messageId);
    if (existing) {
      // attachments: [] drops the old banner so it isn't shown twice
      await existing.edit({ content: payload.content ?? null, embeds: payload.embeds ?? [], files: payload.files ?? [], attachments: [] });
      return existing;
    }
  }
  return sendToChannel(guild, row.channelId, payload, { source: `embeds:${userId}` });
}

export function registerEmbedRoutes(app: FastifyInstance) {
  app.register(async (r) => {
    r.addHook("preHandler", requireGuildAccess);

    /* ---------- images ---------- */

    r.post<GP & { Body: { image: string; name?: string } }>("/api/guilds/:guildId/media", { bodyLimit: 12 * 1024 * 1024 }, async (req, reply) => {
      const m = typeof req.body?.image === "string" ? req.body.image.match(dataUrlRe) : null;
      if (!m) return apiError(reply, 400, "errors.imageFormat");
      const data = Buffer.from(m[2], "base64");
      if (data.length > MAX_IMAGE_BYTES) return apiError(reply, 400, "errors.imageTooLarge", { mb: 8 });
      const [row] = await db
        .insert(schema.media)
        .values({ guildId: req.params.guildId, name: String(req.body.name ?? "").slice(0, 200), mime: m[1], size: data.length, data, createdBy: req.session!.userId })
        .returning({ id: schema.media.id, size: schema.media.size, mime: schema.media.mime });
      return row;
    });

    /** Served to the dashboard for previews (same-origin, so the session cookie comes along) */
    r.get<IdP>("/api/guilds/:guildId/media/:id", async (req, reply) => {
      const [row] = await db
        .select()
        .from(schema.media)
        .where(and(eq(schema.media.id, Number(req.params.id)), eq(schema.media.guildId, req.params.guildId)));
      if (!row) return apiError(reply, 404, "errors.notFound");
      return reply.header("content-type", row.mime).header("cache-control", "private, max-age=86400").send(row.data);
    });

    /** Welcome card preview, rendered with the logged-in user as the "new member" */
    r.post<GP>("/api/guilds/:guildId/card-preview", async (req, reply) => {
      const image = imageSchema.parse((req.body as { image?: unknown })?.image ?? {});
      image.card.enabled = true;
      const s = req.session!;
      const real = discordGuild(req.params.guildId);
      const member = real ? await real.members.fetch(s.userId).catch(() => null) : null;
      // Without the bot (dev) we fake just enough of a guild and user to draw the card
      const guild = real ?? ({ id: req.params.guildId, name: "Server", memberCount: 0, iconURL: () => null } as unknown as Guild);
      const user =
        member?.user ??
        ({
          id: s.userId,
          username: s.username,
          globalName: null,
          displayAvatarURL: () => (s.avatar ? `https://cdn.discordapp.com/avatars/${s.userId}/${s.avatar}.png?size=256` : `https://cdn.discordapp.com/embed/avatars/0.png`),
        } as unknown as User);
      const png = await renderWelcomeCard(image, { guild, member: member as GuildMember | null, user, brandColor: await brandColor(req.params.guildId) });
      if (!png) return apiError(reply, 500, "errors.serverError");
      return reply.header("content-type", "image/png").header("cache-control", "no-store").send(png);
    });

    /* ---------- embed messages ---------- */

    r.get<GP>("/api/guilds/:guildId/embeds", async (req) =>
      db.select().from(schema.embedMessages).where(eq(schema.embedMessages.guildId, req.params.guildId)).orderBy(desc(schema.embedMessages.updatedAt)),
    );

    r.post<GP>("/api/guilds/:guildId/embeds", async (req, reply) => {
      const body = embedBody.parse(req.body);
      const guild = discordGuild(req.params.guildId);
      if (!guild) return apiError(reply, 404, "errors.botNotInGuild");
      const msg = await publish(guild, { channelId: body.channelId, messageId: null, design: body.design }, req.session!.userId);
      if (!msg) return apiError(reply, 400, "errors.botCannotWrite");
      const [row] = await db
        .insert(schema.embedMessages)
        .values({ guildId: req.params.guildId, name: body.name, channelId: body.channelId, messageId: msg.id, design: body.design })
        .returning();
      await audit(req.params.guildId, req.session!.userId, "embeds.create", { id: row.id, channelId: body.channelId });
      return { ...row, url: msg.url };
    });

    r.put<IdP>("/api/guilds/:guildId/embeds/:id", async (req, reply) => {
      const body = embedBody.parse(req.body);
      const t = schema.embedMessages;
      const [existing] = await db.select().from(t).where(and(eq(t.id, Number(req.params.id)), eq(t.guildId, req.params.guildId)));
      if (!existing) return apiError(reply, 404, "errors.notFound");
      const guild = discordGuild(req.params.guildId);
      if (!guild) return apiError(reply, 404, "errors.botNotInGuild");
      // Moving to another channel posts a new message and removes the old one
      const movedFrom = existing.channelId !== body.channelId && existing.messageId ? existing : null;
      const msg = await publish(guild, { channelId: body.channelId, messageId: movedFrom ? null : existing.messageId, design: body.design }, req.session!.userId);
      if (!msg) return apiError(reply, 400, "errors.botCannotWrite");
      if (movedFrom) await (await fetchOwnMessage(guild, movedFrom.channelId, movedFrom.messageId!))?.delete().catch(() => {});
      const [row] = await db
        .update(t)
        .set({ name: body.name, channelId: body.channelId, messageId: msg.id, design: body.design, updatedAt: new Date() })
        .where(eq(t.id, existing.id))
        .returning();
      await audit(req.params.guildId, req.session!.userId, "embeds.update", { id: row.id });
      return { ...row, url: msg.url };
    });

    r.delete<IdP & { Querystring: { keepMessage?: string } }>("/api/guilds/:guildId/embeds/:id", async (req) => {
      const t = schema.embedMessages;
      const [row] = await db.delete(t).where(and(eq(t.id, Number(req.params.id)), eq(t.guildId, req.params.guildId))).returning();
      const guild = discordGuild(req.params.guildId);
      if (row?.messageId && guild && req.query.keepMessage !== "1") await (await fetchOwnMessage(guild, row.channelId, row.messageId))?.delete().catch(() => {});
      await audit(req.params.guildId, req.session!.userId, "embeds.delete", { id: req.params.id });
      return { ok: true };
    });

    /** Sends a design once to a channel without saving it — used by "Send test" for welcome messages */
    r.post<GP>("/api/guilds/:guildId/embeds/test", async (req, reply) => {
      const body = z.object({ channelId: snowflake, design: designSchema, fallback: z.string().max(2000).default("") }).parse(req.body);
      const guild = discordGuild(req.params.guildId);
      if (!guild) return apiError(reply, 404, "errors.botNotInGuild");
      const member = await guild.members.fetch(req.session!.userId).catch(() => null);
      const payload = await buildDesigned(body.design, { guild, member, brandColor: await brandColor(guild.id), fallbackText: body.fallback });
      const msg = await sendToChannel(guild, body.channelId, payload, { source: `embeds:test:${req.session!.userId}` });
      if (!msg) return apiError(reply, 400, "errors.botCannotWrite");
      return { url: msg.url };
    });
  });
}
