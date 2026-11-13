import type { Guild, Interaction, RESTPostAPIChatInputApplicationCommandsJSONBody, APIApplicationCommandOption } from "discord.js";
import { translate, langFromLocale, discordLocales, languages, isLang, intlLocale, type Lang, type TKey, type TParams } from "./core.js";
import { getModule } from "../settings.js";

export { translate as t, langFromLocale, isLang, languages, intlLocale, type Lang, type TKey, type TParams };

/** Language for public messages in a guild: the server setting, or Discord's preferred locale when set to auto. */
export async function guildLang(guild: Guild | { id: string; preferredLocale?: string }): Promise<Lang> {
  const { config } = await getModule(guild.id, "general");
  if (config.language !== "auto") return config.language;
  return langFromLocale("preferredLocale" in guild ? guild.preferredLocale : undefined);
}

/** Translator bound to a guild's language */
export async function guildT(guild: Guild | { id: string; preferredLocale?: string }) {
  const lang = await guildLang(guild);
  return Object.assign((key: TKey, params?: TParams) => translate(lang, key, params), { lang });
}

/** Translator for a private (ephemeral) reply: follows the user's own Discord language */
export function userT(i: Interaction) {
  const lang = langFromLocale(i.locale, "en");
  return Object.assign((key: TKey, params?: TParams) => translate(lang, key, params), { lang });
}

export function fmtNumber(lang: Lang, n: number) {
  return n.toLocaleString(intlLocale[lang]);
}

function localizations(key: string) {
  const out: Record<string, string> = {};
  for (const lang of languages) {
    if (lang === "en") continue;
    const value = translate(lang, key);
    if (value === key) continue;
    for (const loc of discordLocales[lang]) out[loc] = value;
  }
  return out;
}

function hasKey(key: string) {
  return translate("en", key) !== key;
}

/**
 * Fills in descriptions and Swedish (etc.) localizations for a slash command from the
 * `commands.<name>` section of the locale files. Command names stay English so /rank, /warn
 * are the same for everyone; option and subcommand names and all descriptions are translated.
 */
export function localizeCommand(json: RESTPostAPIChatInputApplicationCommandsJSONBody) {
  const base = `commands.${json.name}`;
  if (hasKey(`${base}.description`)) {
    json.description = translate("en", `${base}.description`).slice(0, 100);
    json.description_localizations = localizations(`${base}.description`);
  }
  const walk = (opts: APIApplicationCommandOption[] | undefined) => {
    for (const o of opts ?? []) {
      const isSub = o.type === 1 || o.type === 2;
      const key = `${base}.${isSub ? "subcommands" : "options"}.${o.name}`;
      if (hasKey(`${key}.description`)) {
        o.description = translate("en", `${key}.description`).slice(0, 100);
        o.description_localizations = localizations(`${key}.description`);
      }
      if (hasKey(`${key}.name`)) {
        const names = localizations(`${key}.name`);
        // Discord: names must be lowercase, no spaces
        for (const k of Object.keys(names)) names[k] = names[k].toLowerCase().replace(/\s+/g, "_").slice(0, 32);
        o.name_localizations = names;
      }
      if ("options" in o) walk(o.options as APIApplicationCommandOption[]);
    }
  };
  walk(json.options);
  return json;
}
