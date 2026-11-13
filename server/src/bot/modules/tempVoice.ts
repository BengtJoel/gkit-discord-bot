import {
  ChannelType,
  Events,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type Client,
  type VoiceState,
} from "discord.js";
import { eq } from "drizzle-orm";
import { db, schema } from "../../db/index.js";
import { enabledConfig } from "../../settings.js";
import { renderTemplate } from "../../lib/template.js";
import { defineCommands } from "../registry.js";
import { log } from "../../lib/log.js";
import { guildT, userT } from "../../i18n/index.js";

/** "Join to create": joining a hub channel creates a personal voice channel that is deleted when empty. */
const owners = new Map<string, string>(); // channelId -> ownerId

async function onJoinHub(state: VoiceState) {
  const member = state.member;
  if (!member || !state.channel) return;
  const cfg = await enabledConfig(state.guild.id, "tempVoice");
  if (!cfg || !cfg.hubChannelIds.includes(state.channel.id)) return;

  const parent = cfg.categoryId ?? state.channel.parentId ?? undefined;
  const tr = await guildT(state.guild);
  const name = renderTemplate(cfg.nameTemplate || tr("defaults.tempVoiceName"), { member, guild: state.guild }).slice(0, 100) || member.displayName;
  const channel = await state.guild.channels.create({
    name,
    type: ChannelType.GuildVoice,
    parent,
    userLimit: cfg.userLimit || undefined,
    permissionOverwrites: [
      {
        id: member.id,
        allow: [PermissionFlagsBits.ManageChannels, PermissionFlagsBits.MoveMembers, PermissionFlagsBits.Connect],
      },
    ],
    reason: tr("tempVoice.reasonCreated", { user: member.user.username }),
  });
  owners.set(channel.id, member.id);
  await db.insert(schema.tempChannels).values({ channelId: channel.id, guildId: state.guild.id, ownerId: member.id });
  await member.voice.setChannel(channel).catch(async () => {
    // member left before we could move them
    await channel.delete().catch(() => {});
  });
}

async function maybeCleanup(state: VoiceState) {
  const ch = state.channel;
  if (!ch || !owners.has(ch.id)) return;
  if (ch.members.filter((m) => !m.user.bot).size > 0) return;
  owners.delete(ch.id);
  await db.delete(schema.tempChannels).where(eq(schema.tempChannels.channelId, ch.id));
  const tr = await guildT(state.guild);
  await ch.delete(tr("tempVoice.reasonEmpty")).catch(() => {});
}

export function registerTempVoice(client: Client) {
  client.on(Events.VoiceStateUpdate, async (oldS, newS) => {
    try {
      if (oldS.channelId !== newS.channelId) {
        if (oldS.channelId) await maybeCleanup(oldS);
        if (newS.channelId) await onJoinHub(newS);
      }
    } catch (err) {
      log.warn({ err }, "temp voice failed");
    }
  });

  client.once(Events.ClientReady, async (c) => {
    // Reload + remove channels that emptied while the bot was offline
    const rows = await db.select().from(schema.tempChannels);
    for (const r of rows) {
      const ch = await c.channels.fetch(r.channelId).catch(() => null);
      if (!ch || !ch.isVoiceBased() || ch.members.size === 0) {
        await db.delete(schema.tempChannels).where(eq(schema.tempChannels.channelId, r.channelId));
        if (ch) await ch.delete("Temporary channel empty").catch(() => {});
      } else owners.set(r.channelId, r.ownerId);
    }
  });

  const eph = { flags: MessageFlags.Ephemeral } as const;
  defineCommands([
    {
      module: "tempVoice",
      data: new SlashCommandBuilder()
        .setName("voice")
        .setDescription("voice")
        .addSubcommand((s) => s.setName("name").setDescription("name").addStringOption((o) => o.setName("name").setDescription("name").setRequired(true).setMaxLength(100)))
        .addSubcommand((s) =>
          s.setName("limit").setDescription("limit").addIntegerOption((o) => o.setName("amount").setDescription("amount").setMinValue(0).setMaxValue(99).setRequired(true)),
        )
        .addSubcommand((s) => s.setName("lock").setDescription("lock"))
        .addSubcommand((s) => s.setName("unlock").setDescription("unlock"))
        .addSubcommand((s) => s.setName("claim").setDescription("claim"))
        .toJSON(),
      async execute(i) {
        const tu = userT(i);
        const ch = i.member.voice.channel;
        if (!ch || !owners.has(ch.id)) return i.reply({ content: tu("tempVoice.mustBeInTemp"), ...eph });
        const sub = i.options.getSubcommand();
        const ownerId = owners.get(ch.id)!;
        if (sub === "claim") {
          if (ch.members.has(ownerId)) return i.reply({ content: tu("tempVoice.ownerStillHere"), ...eph });
          owners.set(ch.id, i.user.id);
          await db.update(schema.tempChannels).set({ ownerId: i.user.id }).where(eq(schema.tempChannels.channelId, ch.id));
          await ch.permissionOverwrites.edit(i.user.id, { ManageChannels: true, MoveMembers: true, Connect: true });
          return i.reply({ content: tu("tempVoice.claimed"), ...eph });
        }
        if (ownerId !== i.user.id) return i.reply({ content: tu("tempVoice.onlyOwner"), ...eph });
        if (sub === "name") await ch.setName(i.options.getString("name", true));
        if (sub === "limit") await ch.setUserLimit(i.options.getInteger("amount", true));
        if (sub === "lock") await ch.permissionOverwrites.edit(i.guild.roles.everyone, { Connect: false });
        if (sub === "unlock") await ch.permissionOverwrites.edit(i.guild.roles.everyone, { Connect: null });
        return i.reply({ content: tu("tempVoice.done"), ...eph });
      },
    },
  ]);
}
