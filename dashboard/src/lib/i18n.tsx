import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { translate, languages, languageNames, intlLocale, langFromLocale, isLang, type Lang, type TKey, type TParams } from "@i18n/core";

export { languages, languageNames, type Lang, type TKey };

const STORAGE_KEY = "gk.lang";

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (isLang(saved)) return saved;
  } catch {
    /* storage unavailable */
  }
  return langFromLocale(navigator.language, "en");
}

/** Current language for code outside React (formatters, API error messages) */
let current: Lang = initialLang();
export const currentLang = () => current;
export const currentLocale = () => intlLocale[current];
export const tr = (key: TKey | string, params?: TParams) => translate(current, key, params);

interface Ctx {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: TKey, params?: TParams) => string;
  locale: string;
}
const I18nCtx = createContext<Ctx | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(current);
  const value = useMemo<Ctx>(
    () => ({
      lang,
      locale: intlLocale[lang],
      t: (key, params) => translate(lang, key, params),
      setLang: (l) => {
        current = l;
        try {
          localStorage.setItem(STORAGE_KEY, l);
        } catch {
          /* ignore */
        }
        document.documentElement.lang = l;
        setLangState(l);
      },
    }),
    [lang],
  );
  current = lang;
  return <I18nCtx.Provider value={value}>{children}</I18nCtx.Provider>;
}

export function useT() {
  const c = useContext(I18nCtx);
  if (!c) throw new Error("useT outside I18nProvider");
  return c;
}
