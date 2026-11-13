/**
 * Tiny, dependency-free i18n core shared by the bot and the dashboard.
 * - English is the source language; every key must exist in en.
 * - Params use {{name}} so they never clash with user template variables like {user}.
 * - Plurals: pass `count` and provide `key_one` / `key_other` variants.
 */
import enBot from "./locales/en/bot.json" with { type: "json" };
import enDash from "./locales/en/dashboard.json" with { type: "json" };
import svBot from "./locales/sv/bot.json" with { type: "json" };
import svDash from "./locales/sv/dashboard.json" with { type: "json" };

export const languages = ["en", "sv"] as const;
export type Lang = (typeof languages)[number];
export const languageNames: Record<Lang, string> = { en: "English", sv: "Svenska" };
/** Discord locale codes used for slash command localizations */
export const discordLocales: Record<Exclude<Lang, "en">, string[]> = { sv: ["sv-SE"] };

const en = { ...enBot, ...enDash };
type Dict = typeof en;

type Leaves<T, P extends string = ""> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : Leaves<T[K], `${P}${K}.`>;
}[keyof T & string];
type StripPlural<K extends string> = K extends `${infer B}_one` ? B : K extends `${infer B}_other` ? B : K;
export type TKey = StripPlural<Leaves<Dict>>;
export type TParams = Record<string, string | number | null | undefined>;

export const dictionaries: Record<Lang, Record<string, unknown>> = {
  en,
  sv: { ...svBot, ...svDash },
};

function lookup(dict: Record<string, unknown>, key: string): string | undefined {
  let cur: unknown = dict;
  for (const part of key.split(".")) {
    if (cur && typeof cur === "object" && part in (cur as object)) cur = (cur as Record<string, unknown>)[part];
    else return undefined;
  }
  return typeof cur === "string" ? cur : undefined;
}

const pluralRules = new Map<Lang, Intl.PluralRules>();

export function translate(lang: Lang, key: TKey | string, params?: TParams): string {
  let k = key as string;
  if (params && typeof params.count === "number") {
    const rules = pluralRules.get(lang) ?? new Intl.PluralRules(lang);
    pluralRules.set(lang, rules);
    const form = rules.select(params.count) === "one" ? "one" : "other";
    if (lookup(dictionaries[lang], `${k}_${form}`) ?? lookup(en, `${k}_${form}`)) k = `${k}_${form}`;
  }
  const raw = lookup(dictionaries[lang], k) ?? lookup(en, k) ?? k;
  if (!params) return raw;
  return raw.replace(/\{\{(\w+)\}\}/g, (m, name: string) => (params[name] ?? m).toString());
}

export function isLang(v: unknown): v is Lang {
  return typeof v === "string" && (languages as readonly string[]).includes(v);
}

/** "sv-SE" -> "sv", "en-GB" -> "en", unknown -> fallback */
export function langFromLocale(locale: string | null | undefined, fallback: Lang = "en"): Lang {
  const base = (locale ?? "").toLowerCase().split("-")[0];
  return isLang(base) ? base : fallback;
}

/** BCP-47 tag for Intl formatting */
export const intlLocale: Record<Lang, string> = { en: "en-GB", sv: "sv-SE" };

/** Flattened key list, used by the parity test */
export function flatKeys(obj: Record<string, unknown>, prefix = ""): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === "object" ? flatKeys(v as Record<string, unknown>, `${prefix}${k}.`) : [`${prefix}${k}`],
  );
}
