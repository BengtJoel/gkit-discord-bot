import type {
  ChatInputCommandInteraction,
  RESTPostAPIChatInputApplicationCommandsJSONBody,
  AutocompleteInteraction,
} from "discord.js";
import type { ModuleName } from "../settings.js";

export interface BotCommand {
  /** Module that must be enabled for the command to be registered in a guild */
  module: ModuleName;
  data: RESTPostAPIChatInputApplicationCommandsJSONBody;
  execute: (i: ChatInputCommandInteraction<"cached">) => Promise<unknown>;
  autocomplete?: (i: AutocompleteInteraction<"cached">) => Promise<unknown>;
}

export const commands = new Map<string, BotCommand>();

export function defineCommands(list: BotCommand[]) {
  for (const c of list) commands.set(c.data.name, c);
}
