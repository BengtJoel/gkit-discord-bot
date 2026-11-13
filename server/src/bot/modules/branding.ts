import { Events, type Client, type Guild } from "discord.js";
import { getModule } from "../../settings.js";
import { log } from "../../lib/log.js";

/**
 * Per-server bot profile: nickname, avatar, banner and bio on this server only
 * (Discord's "Modify Current Member"). Avatar and banner are kept by Discord; nickname and bio
 * are also saved in settings so they can be re-applied if the bot is removed and re-added.
 */
export async function applyProfile(guild: Guild, patch: { nick?: string | null; bio?: string | null; avatar?: string | null; banner?: string | null }) {
  return guild.members.editMe(patch);
}

export function profileOf(guild: Guild) {
  const me = guild.members.me;
  return {
    username: guild.client.user?.username ?? "",
    globalAvatarUrl: guild.client.user?.displayAvatarURL({ size: 256 }) ?? null,
    nickname: me?.nickname ?? null,
    avatarUrl: me?.avatar ? me.avatarURL({ size: 256 }) : null,
    bannerUrl: me?.banner ? me.bannerURL({ size: 600 }) : null,
  };
}

export function registerBranding(client: Client) {
  // Re-apply nickname and bio if the bot is re-invited (Discord resets its member profile)
  client.on(Events.GuildCreate, async (guild) => {
    const { config } = await getModule(guild.id, "branding");
    if (!config.nickname && !config.bio) return;
    await applyProfile(guild, { nick: config.nickname, bio: config.bio || null }).catch((err) => log.warn({ err }, "re-applying bot profile failed"));
  });
}
