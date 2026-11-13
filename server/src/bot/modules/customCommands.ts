import { MessageFlags, type ChatInputCommandInteraction, type RESTPostAPIChatInputApplicationCommandsJSONBody } from "discord.js";
import { and, eq, sql as dsql } from "drizzle-orm";
import { db, schema } from "../../db/index.js";
import { renderTemplate } from "../../lib/template.js";

type Row = typeof schema.customCommands.$inferSelect;

export const commandNameRe = /^[a-z0-9_-]{1,32}$/;

export async function listCustomCommands(guildId: string) {
  return db.select().from(schema.customCommands).where(eq(schema.customCommands.guildId, guildId));
}

export function toCommandJSON(row: Row): RESTPostAPIChatInputApplicationCommandsJSONBody {
  return {
    name: row.name,
    description: (row.description || "Custom command").slice(0, 100),
    options: [{ type: 6, name: "user", description: "Valfri användare ({target})", required: false }],
  };
}

/** Returns true if the interaction was a custom command (handled here) */
export async function handleCustomCommand(i: ChatInputCommandInteraction<"cached">): Promise<boolean> {
  const t = schema.customCommands;
  const [row] = await db.select().from(t).where(and(eq(t.guildId, i.guildId), eq(t.name, i.commandName)));
  if (!row) return false;
  const eph = { flags: MessageFlags.Ephemeral } as const;
  if (!row.enabled) {
    await i.reply({ content: "Det här kommandot är avstängt.", ...eph });
    return true;
  }
  const allowed = row.allowedRoleIds as string[];
  if (allowed.length && !i.member.roles.cache.some((r) => allowed.includes(r.id))) {
    await i.reply({ content: "Du har inte behörighet att använda det här kommandot.", ...eph });
    return true;
  }
  const add = row.addRoleIds as string[];
  const remove = row.removeRoleIds as string[];
  if (add.length) await i.member.roles.add(add, `/${row.name}`).catch(() => {});
  if (remove.length) await i.member.roles.remove(remove, `/${row.name}`).catch(() => {});

  const target = i.options.getUser("user");
  const content = renderTemplate(row.response, {
    member: i.member,
    guild: i.guild,
    extra: { target: target ? `<@${target.id}>` : "", channel: `<#${i.channelId}>` },
  });
  await i.reply({ content, flags: row.ephemeral ? MessageFlags.Ephemeral : undefined });
  await db.update(t).set({ uses: dsql`${t.uses} + 1` }).where(eq(t.id, row.id));
  return true;
}
