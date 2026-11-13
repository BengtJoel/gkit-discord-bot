import { Events, type Client } from "discord.js";
import { enabledConfig } from "../../settings.js";
import { renderTemplate } from "../../lib/template.js";
import { recordEvent, upsertMember } from "./activity.js";
import { guildT } from "../../i18n/index.js";
import { addRoles, sendDm, sendToChannel } from "../../core/actions.js";

export function registerWelcome(client: Client) {
  client.on(Events.GuildMemberAdd, async (member) => {
    await upsertMember(member).catch(() => {});
    await recordEvent(member.guild.id, "member_join", { userId: member.id, data: { username: member.user.username } });

    const cfg = await enabledConfig(member.guild.id, "welcome");
    if (!cfg) return;
    const tr = await guildT(member.guild);
    const ctx = { member, guild: member.guild };
    const action = { source: "welcome", reason: tr("welcome.autoroleReason") };
    if (cfg.autoRoleIds.length && !member.pending) await addRoles(member, cfg.autoRoleIds, action);
    if (cfg.join.enabled && cfg.join.channelId)
      await sendToChannel(member.guild, cfg.join.channelId, renderTemplate(cfg.join.message || tr("defaults.welcomeJoin"), ctx), action);
    if (cfg.dm.enabled) await sendDm(member.guild, member.user, renderTemplate(cfg.dm.message || tr("defaults.welcomeDm"), ctx), action);
  });

  // Membership screening: give autoroles once the member accepts the rules
  client.on(Events.GuildMemberUpdate, async (oldM, newM) => {
    if (!(oldM.pending && !newM.pending)) return;
    const cfg = await enabledConfig(newM.guild.id, "welcome");
    if (!cfg?.autoRoleIds.length) return;
    const tr = await guildT(newM.guild);
    await addRoles(newM, cfg.autoRoleIds, { source: "welcome", reason: tr("welcome.autoroleReason") });
  });

  client.on(Events.GuildMemberRemove, async (member) => {
    await upsertMember(member, true).catch(() => {});
    await recordEvent(member.guild.id, "member_leave", { userId: member.id, data: { username: member.user?.username } });
    const cfg = await enabledConfig(member.guild.id, "welcome");
    if (!cfg?.leave.enabled || !cfg.leave.channelId) return;
    const tr = await guildT(member.guild);
    await sendToChannel(
      member.guild,
      cfg.leave.channelId,
      renderTemplate(cfg.leave.message || tr("defaults.welcomeLeave"), { member, guild: member.guild }),
      { source: "welcome" },
    );
  });
}
