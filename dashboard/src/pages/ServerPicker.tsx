import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { LogOut, Plus } from "lucide-react";
import { api, avatarUrl, guildIconUrl, ApiError } from "../lib/api";
import type { Me } from "../lib/types";
import { Button, Spinner } from "../components/ui";
import { useT } from "../lib/i18n";
import { LanguageSwitcher } from "../components/LanguageSwitcher";

export function useMe() {
  return useQuery({ queryKey: ["me"], queryFn: () => api<Me>("/me"), staleTime: 60_000 });
}

export function LoginScreen() {
  const { t } = useT();
  const failed = new URLSearchParams(location.search).has("login_error");
  return (
    <div className="grid min-h-full place-items-center px-4">
      <div className="absolute top-4 right-4">
        <LanguageSwitcher />
      </div>
      <div className="w-full max-w-sm text-center">
        <div className="mx-auto mb-6 grid size-14 place-items-center rounded-2xl bg-accent text-2xl font-bold text-white shadow-[0_0_60px_-10px] shadow-accent">G</div>
        <h1 className="text-2xl font-semibold tracking-tight">GuildKit Bot</h1>
        <p className="mt-2 text-sm text-muted">{t("dash.login.subtitle")}</p>
        {failed && <p className="mt-4 rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-red-200">{t("errors.loginFailed")}</p>}
        <a href="/api/auth/login" className="mt-8 inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[#5865F2] font-medium text-white transition hover:bg-[#4752c4]">
          <svg viewBox="0 0 24 24" className="size-5 fill-current" aria-hidden>
            <path d="M20.3 4.4A19.8 19.8 0 0 0 15.4 3l-.6 1.3a18.4 18.4 0 0 0-5.5 0L8.6 3a19.7 19.7 0 0 0-4.9 1.5C.6 9.1-.3 13.6.1 18.1a19.9 19.9 0 0 0 6 3l1.3-2.1a12.9 12.9 0 0 1-2-1l.5-.4a14.2 14.2 0 0 0 12.2 0l.5.4c-.6.4-1.3.7-2 1l1.3 2.1a19.8 19.8 0 0 0 6-3c.5-5.2-.8-9.7-3.6-13.7ZM8 15.4c-1.2 0-2.2-1.1-2.2-2.4S6.8 10.6 8 10.6s2.2 1.1 2.2 2.4-1 2.4-2.2 2.4Zm8 0c-1.2 0-2.2-1.1-2.2-2.4s1-2.4 2.2-2.4 2.2 1.1 2.2 2.4-1 2.4-2.2 2.4Z" />
          </svg>
          {t("dash.login.button")}
        </a>
      </div>
    </div>
  );
}

export async function logout() {
  await api("/auth/logout", { method: "POST" });
  location.href = "/";
}

export function ServerPicker() {
  const { t } = useT();
  const me = useMe();
  if (me.isLoading) return <div className="grid min-h-full place-items-center"><Spinner /></div>;
  if (me.error instanceof ApiError && me.error.status === 401) return <LoginScreen />;
  if (!me.data) return <div className="p-10 text-center text-muted">{t("dash.common.loadFailed", { error: String(me.error?.message) })}</div>;
  const { user, guilds, inviteUrl } = me.data;
  const withBot = guilds.filter((g) => g.botPresent);
  const without = guilds.filter((g) => !g.botPresent);

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <header className="mb-10 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="grid size-9 place-items-center rounded-lg bg-accent font-bold text-white">G</div>
          <span className="font-semibold">GuildKit Bot</span>
        </div>
        <div className="flex items-center gap-3">
          <LanguageSwitcher />
          <img src={avatarUrl(user.id, user.avatar)} className="size-8 rounded-full" alt="" />
          <span className="text-sm">{user.username}</span>
          <Button variant="ghost" size="sm" icon={<LogOut className="size-4" />} onClick={() => void logout()}>
            {t("dash.common.logout")}
          </Button>
        </div>
      </header>

      <h1 className="text-2xl font-semibold tracking-tight">{t("dash.picker.title")}</h1>
      <p className="mt-1 text-sm text-muted">{t("dash.picker.subtitle")}</p>

      <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {withBot.map((g) => (
          <Link key={g.id} to={`/g/${g.id}`} className="card group flex items-center gap-3 p-4 transition hover:border-accent/50 hover:bg-panel-2">
            <GuildIcon id={g.id} icon={g.icon} name={g.name} />
            <div className="min-w-0">
              <div className="truncate font-medium">{g.name}</div>
              <div className="text-xs text-ok">● {t("dash.picker.installed")}</div>
            </div>
          </Link>
        ))}
      </div>

      {without.length > 0 && (
        <>
          <h2 className="mt-12 text-sm font-semibold tracking-wide text-muted uppercase">{t("dash.picker.addBot")}</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {without.map((g) => (
              <a
                key={g.id}
                href={`${inviteUrl}&guild_id=${g.id}&disable_guild_select=true`}
                className="card flex items-center gap-3 p-4 opacity-70 transition hover:border-line-2 hover:opacity-100"
              >
                <GuildIcon id={g.id} icon={g.icon} name={g.name} />
                <div className="min-w-0 flex-1 truncate font-medium">{g.name}</div>
                <Plus className="size-4 text-muted" />
              </a>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export function GuildIcon({ id, icon, name, size = 44 }: { id: string; icon: string | null; name: string; size?: number }) {
  const url = guildIconUrl(id, icon, 128);
  return url ? (
    <img src={url} alt="" className="shrink-0 rounded-xl" style={{ width: size, height: size }} />
  ) : (
    <div className="grid shrink-0 place-items-center rounded-xl bg-panel-2 text-sm font-semibold text-muted" style={{ width: size, height: size }}>
      {name
        .split(/\s+/)
        .map((w) => w[0])
        .join("")
        .slice(0, 3)}
    </div>
  );
}
