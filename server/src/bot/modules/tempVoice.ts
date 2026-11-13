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

/** "Join to create": joining a hub channel creates a personal voice channel that is deleted when empty. */
const owners = new Map<string, string>(); // channelId -> ownerId

async function onJoinHub(state: VoiceState) {
  const member = state.member;
  if (!member || !state.channel) return;
  const cfg = await enabledConfig(state.guild.id, "tempVoice");
  if (!cfg || !cfg.hubChannelIds.includes(state.channel.id)) return;

  const parent = cfg.categoryId ?? state.channel.parentId ?? undefined;
  const name = renderTemplate(cfg.nameTemplate, { member, guild: state.guild }).slice(0, 100);
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
    reason: `Tillfällig kanal för ${member.user.username}`,
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
  await ch.delete("Tillfällig kanal tom").catch(() => {});
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
        if (ch) await ch.delete("Tillfällig kanal tom").catch(() => {});
      } else owners.set(r.channelId, r.ownerId);
    }
  });

  const eph = { flags: MessageFlags.Ephemeral } as const;
  defineCommands([
    {
      module: "tempVoice",
      data: new SlashCommandBuilder()
        .setName("voice")
        .setDescription("Hantera din tillfälliga röstkanal")
        .addSubcommand((s) =>
          s.setName("namn").setDescription("Byt namn").addStringOption((o) => o.setName("namn").setDescription("Nytt namn").setRequired(true).setMaxLength(100)),
        )
        .addSubcommand((s) =>
          s
            .setName("gräns")
            .setDescription("Sätt max antal (0 = obegränsat)")
            .addIntegerOption((o) => o.setName("antal").setDescription("0-99").setMinValue(0).setMaxValue(99).setRequired(true)),
        )
        .addSubcommand((s) => s.setName("lås").setDescription("Lås kanalen"))
        .addSubcommand((s) => s.setName("lås_upp").setDescription("Lås upp kanalen"))
        .addSubcommand((s) => s.setName("ta_över").setDescription("Ta över kanalen om ägaren har gått"))
        .toJSON(),
      async execute(i) {
        const ch = i.member.voice.channel;
        if (!ch || !owners.has(ch.id)) return i.reply({ content: "Du måste sitta i en tillfällig kanal.", ...eph });
        const sub = i.options.getSubcommand();
        const ownerId = owners.get(ch.id)!;
        if (sub === "ta_över") {
          if (ch.members.has(ownerId)) return i.reply({ content: "Ägaren är fortfarande kvar.", ...eph });
          owners.set(ch.id, i.user.id);
          await db.update(schema.tempChannels).set({ ownerId: i.user.id }).where(eq(schema.tempChannels.channelId, ch.id));
          await ch.permissionOverwrites.edit(i.user.id, { ManageChannels: true, MoveMembers: true, Connect: true });
          return i.reply({ content: "Kanalen är nu din.", ...eph });
        }
        if (ownerId !== i.user.id) return i.reply({ content: "Bara kanalens ägare kan göra det.", ...eph });
        if (sub === "namn") await ch.setName(i.options.getString("namn", true));
        if (sub === "gräns") await ch.setUserLimit(i.options.getInteger("antal", true));
        if (sub === "lås") await ch.permissionOverwrites.edit(i.guild.roles.everyone, { Connect: false });
        if (sub === "lås_upp") await ch.permissionOverwrites.edit(i.guild.roles.everyone, { Connect: null });
        return i.reply({ content: "Klart ✅", ...eph });
      },
    },
  ]);
}
