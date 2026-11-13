import { describe, expect, it } from "vitest";
import { dictionaries, flatKeys, translate, langFromLocale, languages } from "../src/i18n/core.js";

const params = (s: string) => [...s.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();
const get = (d: Record<string, unknown>, k: string) => k.split(".").reduce<unknown>((o, p) => (o as Record<string, unknown>)?.[p], d) as string;

describe("locale files", () => {
  const enKeys = flatKeys(dictionaries.en).sort();

  for (const lang of languages.filter((l) => l !== "en")) {
    it(`${lang} has exactly the same keys as en`, () => {
      const keys = flatKeys(dictionaries[lang]).sort();
      expect(keys.filter((k) => !enKeys.includes(k)), "extra keys").toEqual([]);
      expect(enKeys.filter((k) => !keys.includes(k)), "missing keys").toEqual([]);
    });

    it(`${lang} uses the same {{params}} as en`, () => {
      const mismatched = enKeys.filter((k) => JSON.stringify(params(get(dictionaries.en, k))) !== JSON.stringify(params(get(dictionaries[lang], k) ?? "")));
      expect(mismatched).toEqual([]);
    });

    it(`${lang} keeps user template variables like {user} intact`, () => {
      for (const k of flatKeys(dictionaries.en).filter((k) => k.startsWith("defaults."))) {
        const vars = (s: string) => [...s.matchAll(/(?<!\{)\{(\w+)\}(?!\})/g)].map((m) => m[1]).sort();
        expect(vars(get(dictionaries[lang], k)), k).toEqual(vars(get(dictionaries.en, k)));
      }
    });
  }

  it("no value is empty", () => {
    for (const lang of languages) for (const k of flatKeys(dictionaries[lang])) expect(get(dictionaries[lang], k), `${lang}:${k}`).not.toBe("");
  });
});

describe("translate", () => {
  it("interpolates and pluralises", () => {
    expect(translate("en", "moderation.purged", { count: 1 })).toBe("🧹 Deleted 1 message.");
    expect(translate("en", "moderation.purged", { count: 3 })).toBe("🧹 Deleted 3 messages.");
    expect(translate("sv", "moderation.purged", { count: 3 })).toBe("🧹 Raderade 3 meddelanden.");
  });
  it("falls back to the key for unknown keys", () => {
    expect(translate("sv", "does.not.exist")).toBe("does.not.exist");
  });
  it("maps Discord locales", () => {
    expect(langFromLocale("sv-SE")).toBe("sv");
    expect(langFromLocale("en-US")).toBe("en");
    expect(langFromLocale("de")).toBe("en");
    expect(langFromLocale(undefined, "sv")).toBe("sv");
  });
});
