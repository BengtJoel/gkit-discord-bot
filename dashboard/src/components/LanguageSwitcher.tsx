import { Globe } from "lucide-react";
import { languages, languageNames, useT, type Lang } from "../lib/i18n";

/** Dashboard language (per browser). The bot's language in Discord is set per server under Settings. */
export function LanguageSwitcher({ compact }: { compact?: boolean }) {
  const { lang, setLang, t } = useT();
  return (
    <label className="relative inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-fg" title={t("dash.language.dashboard")}>
      <Globe className="size-4" />
      <select
        value={lang}
        onChange={(e) => setLang(e.target.value as Lang)}
        className="cursor-pointer appearance-none bg-transparent pr-1 outline-none"
        aria-label={t("dash.language.dashboard")}
      >
        {languages.map((l) => (
          <option key={l} value={l} className="bg-panel text-fg">
            {compact ? l.toUpperCase() : languageNames[l]}
          </option>
        ))}
      </select>
    </label>
  );
}
