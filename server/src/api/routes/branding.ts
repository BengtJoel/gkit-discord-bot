import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getModule, saveModule } from "../../settings.js";
import { requireGuildAccess } from "../auth.js";
import { apiError } from "../errors.js";
import { audit, discordGuild, type GP } from "./guild.js";
import { applyProfile, profileOf } from "../../bot/modules/branding.js";

/** Discord accepts PNG, JPEG, GIF and WebP; 8 MB keeps us well inside its upload limits */
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const imageRe = /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/;

const profileBody = z.object({
  nickname: z.string().trim().max(32).nullable().optional(),
  bio: z.string().max(190).optional(),
  color: z
    .string()
    .regex(/^#[0-9a-f]{6}$/i)
    .optional(),
});

function discordMessage(err: unknown) {
  const e = err as { status?: number; code?: number; message?: string };
  if (e.status === 429) return "errors.discordRateLimited";
  if (e.status === 403) return "errors.missingPermission";
  return "errors.discordRejected";
}

export function registerBrandingRoutes(app: FastifyInstance) {
  app.register(async (r) => {
    r.addHook("preHandler", requireGuildAccess);

    r.get<GP>("/api/guilds/:guildId/branding", async (req) => {
      const g = discordGuild(req.params.guildId);
      const { config } = await getModule(req.params.guildId, "branding");
      return { config, profile: g ? profileOf(g) : null };
    });

    r.put<GP>("/api/guilds/:guildId/branding", async (req, reply) => {
      const body = profileBody.parse(req.body ?? {});
      const { config } = await getModule(req.params.guildId, "branding");
      const next = {
        nickname: body.nickname === undefined ? config.nickname : body.nickname || null,
        bio: body.bio ?? config.bio,
        color: body.color ?? config.color,
      };
      const g = discordGuild(req.params.guildId);
      if (g && (next.nickname !== config.nickname || next.bio !== config.bio)) {
        try {
          await applyProfile(g, { nick: next.nickname, bio: next.bio || null });
        } catch (err) {
          return apiError(reply, 400, discordMessage(err), { permission: "Change Nickname" });
        }
      }
      const state = await saveModule(req.params.guildId, "branding", { enabled: true, config: next }, req.session!.userId);
      await audit(req.params.guildId, req.session!.userId, "branding.update", { nickname: next.nickname, color: next.color });
      return { config: state.config, profile: g ? profileOf(g) : null };
    });

    for (const kind of ["avatar", "banner"] as const) {
      r.put<GP & { Body: { image: string | null } }>(
        `/api/guilds/:guildId/branding/${kind}`,
        { bodyLimit: 12 * 1024 * 1024 },
        async (req, reply) => {
          const image = req.body?.image ?? null;
          if (image !== null) {
            if (typeof image !== "string" || !imageRe.test(image)) return apiError(reply, 400, "errors.imageFormat");
            const bytes = Math.floor((image.length - image.indexOf(",") - 1) * 0.75);
            if (bytes > MAX_IMAGE_BYTES) return apiError(reply, 400, "errors.imageTooLarge", { mb: 8 });
          }
          const g = discordGuild(req.params.guildId);
          if (!g) return apiError(reply, 404, "errors.botNotInGuild");
          try {
            await applyProfile(g, { [kind]: image });
          } catch (err) {
            return apiError(reply, 400, discordMessage(err));
          }
          await audit(req.params.guildId, req.session!.userId, `branding.${kind}`, { removed: image === null });
          return { profile: profileOf(g) };
        },
      );
    }
  });
}
