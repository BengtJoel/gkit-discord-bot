import { Client, Events, GatewayIntentBits, Partials, MessageFlags, type Guild } from "discord.js";
import { db, schema } from "../db/index.js";
import { getModule } from "../settings.js";
import { log } from "../lib/log.js";
import { userT } from "../i18n/index.js";
import { registerGateway } from "../core/events.js";
import { commands } from "./registry.js";
import { registerActivity, trackCommand, upsertMember, flushActivity } from "./modules/activity.js";
import { registerLevels } from "./modules/levels.js";
import { registerReactionRoles, loadReactionRoles } from "./modules/reactionRoles.js";
import { registerWelcome } from "./modules/welcome.js";
import { registerModeration } from "./modules/moderation.js";
import { registerAutomod } from "./modules/automod.js";
import { handleCustomCommand, listCustomCommands, toCommandJSON } from "./modules/customCommands.js";
import { startTimers } from "./modules/timers.js";
import { registerTempVoice } from "./modules/tempVoice.js";
import { registerServerLog } from "./modules/serverLog.js";
import { registerBranding } from "./modules/branding.js";
import { startJobWorker, stopJobWorker } from "../core/jobs.js";
import { pruneActionLog } from "../core/actions.js";

export const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers, // privileged: welcome, autoroles, member list
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, // privileged: automod
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildExpressions, // emoji added/removed in the server log
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction, Partials.User, Partials.GuildMember],
});

/**
 * Registers slash commands per guild: built-ins for enabled modules + that guild's custom commands.
 * Guild commands update instantly (global ones can take up to an hour), and disabled modules
 * don't clutter the command list.
 */
export async function syncGuildCommands(guild: Guild) {
  const body = [];
  for (const cmd of commands.values()) {
    if ((await getModule(guild.id, cmd.module)).enabled) body.push(cmd.data);
  }
  if ((await getModule(guild.id, "customCommands")).enabled) {
    const builtinNames = new Set(body.map((b) => b.name));
    for (const c of await listCustomCommands(guild.id)) if (!builtinNames.has(c.name)) body.push(toCommandJSON(c));
  }
  await guild.commands.set(body);
  log.debug({ guild: guild.id, count: body.length }, "commands synced");
}

async function upsertGuild(guild: Guild, left = false) {
  await db
    .insert(schema.guilds)
    .values({ id: guild.id, name: guild.name, icon: guild.icon })
    .onConflictDoUpdate({
      target: schema.guilds.id,
      set: { name: guild.name, icon: guild.icon, leftAt: left ? new Date() : null },
    });
}

export async function startBot(token: string) {
  registerGateway(client);
  registerActivity(client);
  registerLevels(client);
  registerReactionRoles(client);
  registerWelcome(client);
  registerModeration();
  registerAutomod(client);
  registerTempVoice(client);
  registerServerLog(client);
  registerBranding(client);

  client.once(Events.ClientReady, async (c) => {
    log.info({ tag: c.user.tag, guilds: c.guilds.cache.size }, "Bot ready");
    await loadReactionRoles();
    await startTimers(c);
    await startJobWorker();
    await pruneActionLog().catch(() => {});
    setInterval(() => void pruneActionLog().catch(() => {}), 86400_000).unref();
    for (const guild of c.guilds.cache.values()) {
      await upsertGuild(guild).catch((err) => log.error({ err }, "upsertGuild"));
      await syncGuildCommands(guild).catch((err) => log.error({ err, guild: guild.id }, "command sync failed"));
    }
  });

  client.on(Events.GuildCreate, async (guild) => {
    log.info({ guild: guild.id, name: guild.name }, "Joined guild");
    await upsertGuild(guild);
    await syncGuildCommands(guild).catch((err) => log.error({ err }, "command sync failed"));
    // Seed the member table so reports have data from day one
    const members = await guild.members.fetch().catch(() => null);
    if (members) for (const m of members.values()) await upsertMember(m).catch(() => {});
  });
  client.on(Events.GuildDelete, (guild) => void upsertGuild(guild, true).catch(() => {}));

  client.on(Events.InteractionCreate, async (i) => {
    if (!i.inCachedGuild()) return;
    try {
      if (i.isAutocomplete()) {
        await commands.get(i.commandName)?.autocomplete?.(i);
        return;
      }
      if (!i.isChatInputCommand()) return;
      trackCommand(i.guildId, i.user.id);
      const builtin = commands.get(i.commandName);
      if (builtin) {
        if (!(await getModule(i.guildId, builtin.module)).enabled) {
          await i.reply({ content: userT(i)("common.moduleDisabled"), flags: MessageFlags.Ephemeral });
          return;
        }
        await builtin.execute(i);
        return;
      }
      await handleCustomCommand(i);
    } catch (err) {
      log.error({ err, command: i.isCommand() ? i.commandName : undefined }, "interaction failed");
      if (i.isRepliable()) {
        const payload = { content: userT(i)("common.somethingWrong"), flags: MessageFlags.Ephemeral } as const;
        if (i.deferred || i.replied) await i.followUp(payload).catch(() => {});
        else await i.reply(payload).catch(() => {});
      }
    }
  });

  await client.login(token);
}

export async function stopBot() {
  stopJobWorker();
  await flushActivity();
  await client.destroy();
}
