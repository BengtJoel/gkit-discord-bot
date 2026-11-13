import type {
  ChatInputCommandInteraction,
  RESTPostAPIChatInputApplicationCommandsJSONBody,
  AutocompleteInteraction,
} from "discord.js";
import type { ModuleName } from "../settings.js";
import { localizeCommand } from "../i18n/index.js";

export interface BotCommand {
  /** Module that must be enabled for the command to be registered in a guild */
  module: ModuleName;
  data: RESTPostAPIChatInputApplicationCommandsJSONBody;
  execute: (i: ChatInputCommandInteraction<"cached">) => Promise<unknown>;
  autocomplete?: (i: AutocompleteInteraction<"cached">) => Promise<unknown>;
}

export const commands = new Map<string, BotCommand>();

/** Registers commands; descriptions and translations come from the `commands.*` locale keys */
export function defineCommands(list: BotCommand[]) {
  for (const c of list) commands.set(c.data.name, { ...c, data: localizeCommand(c.data) });
}
