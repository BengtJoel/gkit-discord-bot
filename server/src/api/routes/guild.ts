import type { FastifyInstance } from "fastify";
import { ChannelType } from "discord.js";
import { db, schema } from "../../db/index.js";
import { getAllModules, isModule, saveModule, moduleNames } from "../../settings.js";
import { client, syncGuildCommands } from "../../bot/client.js";
import { botEnabled } from "../../env.js";
import { requireGuildAccess } from "../auth.js";

export type GP = { Params: { guildId: string } };

export const discordGuild = (id: string) => (botEnabled ? client.guilds.cache.get(id) ?? null : null);

export async function audit(guildId: string, userId: string, action: string, data: Record<string, unknown> = {}) {
  await db.insert(schema.auditLog).values({ guildId, userId, action, data }).catch(() => {});
}

/** Modules whose on/off state changes which slash commands exist */
const commandModules = new Set(["levels", "moderation", "tempVoice", "customCommands"]);

export function registerGuildRoutes(app: FastifyInstance) {
  app.register(async (r) => {
    r.addHook("preHandler", requireGuildAccess);

    r.get<GP>("/api/guilds/:guildId", async (req) => {
      const g = discordGuild(req.params.guildId);
      const channels = g
        ? [...g.channels.cache.values()]
            .filter((c) => !c.isThread())
            .map((c) => ({
              id: c.id,
              name: c.name,
              type:
                c.type === ChannelType.GuildCategory
                  ? "category"
                  : c.type === ChannelType.GuildVoice || c.type === ChannelType.GuildStageVoice
                    ? "voice"
                    : c.type === ChannelType.GuildForum
                      ? "forum"
                      : "text",
              parentId: "parentId" in c ? c.parentId : null,
              position: "rawPosition" in c ? c.rawPosition : 0,
            }))
            .sort((a, b) => a.position - b.position)
        : [];
      const me = g?.members.me;
      const roles = g
        ? [...g.roles.cache.values()]
            .filter((r) => r.id !== g.id)
            .sort((a, b) => b.position - a.position)
            .map((r) => ({
              id: r.id,
              name: r.name,
              color: r.hexColor,
              managed: r.managed,
              // false if the bot cannot assign it (role above the bot's highest role)
              assignable: !r.managed && !!me && me.roles.highest.comparePositionTo(r) > 0,
            }))
        : [];
      const emojis = g ? [...g.emojis.cache.values()].map((e) => ({ id: e.id, name: e.name, animated: e.animated, tag: e.toString() })) : [];
      return {
        id: req.params.guildId,
        name: g?.name ?? "Utvecklingsläge",
        icon: g?.icon ?? null,
        memberCount: g?.memberCount ?? 0,
        channels,
        roles,
        emojis,
        modules: await getAllModules(req.params.guildId),
      };
    });

    r.put<GP & { Params: { module: string }; Body: { enabled?: boolean; config?: unknown } }>(
      "/api/guilds/:guildId/modules/:module",
      async (req, reply) => {
        const { guildId, module } = req.params;
        if (!isModule(module)) return reply.code(404).send({ error: "Okänd modul" });
        const before = (await getAllModules(guildId))[module];
        const state = await saveModule(guildId, module, req.body ?? {}, req.session!.userId);
        await audit(guildId, req.session!.userId, `module.${module}.update`, { enabled: state.enabled });
        if (commandModules.has(module) && before.enabled !== state.enabled) {
          const g = discordGuild(guildId);
          if (g) await syncGuildCommands(g).catch(() => {});
        }
        return state;
      },
    );

    r.get<GP>("/api/guilds/:guildId/modules", async (req) => getAllModules(req.params.guildId));
    r.get("/api/modules", async () => moduleNames);
  });
}
