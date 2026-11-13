import { MessageFlags, type ChatInputCommandInteraction, type RESTPostAPIChatInputApplicationCommandsJSONBody } from "discord.js";
import { and, eq, sql as dsql } from "drizzle-orm";
import { db, schema } from "../../db/index.js";
import { renderTemplate } from "../../lib/template.js";
import { t, userT } from "../../i18n/index.js";
import { languages, discordLocales } from "../../i18n/core.js";
import { addRoles, removeRoles } from "../../core/actions.js";

type Row = typeof schema.customCommands.$inferSelect;

export const commandNameRe = /^[a-z0-9_-]{1,32}$/;

export async function listCustomCommands(guildId: string) {
  return db.select().from(schema.customCommands).where(eq(schema.customCommands.guildId, guildId));
}

export function toCommandJSON(row: Row): RESTPostAPIChatInputApplicationCommandsJSONBody {
  return {
    name: row.name,
    description: (row.description || "Custom command").slice(0, 100),
    options: [
      {
        type: 6,
        name: "user",
        description: t("en", "customCommands.userOption"),
        description_localizations: Object.fromEntries(
          languages.filter((l) => l !== "en").flatMap((l) => discordLocales[l as "sv"].map((loc) => [loc, t(l, "customCommands.userOption")])),
        ),
        required: false,
      },
    ],
  };
}

/** Returns true if the interaction was a custom command (handled here) */
export async function handleCustomCommand(i: ChatInputCommandInteraction<"cached">): Promise<boolean> {
  const t = schema.customCommands;
  const [row] = await db.select().from(t).where(and(eq(t.guildId, i.guildId), eq(t.name, i.commandName)));
  if (!row) return false;
  const eph = { flags: MessageFlags.Ephemeral } as const;
  const tu = userT(i);
  if (!row.enabled) {
    await i.reply({ content: tu("customCommands.disabled"), ...eph });
    return true;
  }
  const allowed = row.allowedRoleIds as string[];
  if (allowed.length && !i.member.roles.cache.some((r) => allowed.includes(r.id))) {
    await i.reply({ content: tu("customCommands.noPermission"), ...eph });
    return true;
  }
  const add = row.addRoleIds as string[];
  const remove = row.removeRoleIds as string[];
  const ctx = { source: `command:${row.name}`, reason: `/${row.name}` };
  if (add.length) await addRoles(i.member, add, ctx);
  if (remove.length) await removeRoles(i.member, remove, ctx);

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
