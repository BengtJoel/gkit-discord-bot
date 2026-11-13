import { Events, type Client } from "discord.js";
import { enabledConfig } from "../../settings.js";
import { renderTemplate } from "../../lib/template.js";
import { recordEvent, upsertMember } from "./activity.js";
import { log } from "../../lib/log.js";

export function registerWelcome(client: Client) {
  client.on(Events.GuildMemberAdd, async (member) => {
    await upsertMember(member).catch(() => {});
    await recordEvent(member.guild.id, "member_join", { userId: member.id, data: { username: member.user.username } });

    const cfg = await enabledConfig(member.guild.id, "welcome");
    if (!cfg) return;
    const ctx = { member, guild: member.guild };
    try {
      if (cfg.autoRoleIds.length && !member.pending) await member.roles.add(cfg.autoRoleIds, "Autoroll");
      if (cfg.join.enabled && cfg.join.channelId) {
        const ch = await member.guild.channels.fetch(cfg.join.channelId);
        if (ch?.isTextBased()) await ch.send(renderTemplate(cfg.join.message, ctx));
      }
      if (cfg.dm.enabled) await member.send(renderTemplate(cfg.dm.message, ctx)).catch(() => {});
    } catch (err) {
      log.warn({ err, guild: member.guild.id }, "welcome failed");
    }
  });

  // Membership screening: give autoroles once the member accepts the rules
  client.on(Events.GuildMemberUpdate, async (oldM, newM) => {
    if (!(oldM.pending && !newM.pending)) return;
    const cfg = await enabledConfig(newM.guild.id, "welcome");
    if (cfg?.autoRoleIds.length) await newM.roles.add(cfg.autoRoleIds, "Autoroll").catch(() => {});
  });

  client.on(Events.GuildMemberRemove, async (member) => {
    await upsertMember(member, true).catch(() => {});
    await recordEvent(member.guild.id, "member_leave", { userId: member.id, data: { username: member.user?.username } });
    const cfg = await enabledConfig(member.guild.id, "welcome");
    if (!cfg?.leave.enabled || !cfg.leave.channelId) return;
    const ch = await member.guild.channels.fetch(cfg.leave.channelId).catch(() => null);
    if (ch?.isTextBased()) await ch.send(renderTemplate(cfg.leave.message, { member, guild: member.guild })).catch(() => {});
  });
}
