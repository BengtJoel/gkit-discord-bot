import { NavLink, Outlet, useParams, Link } from "react-router-dom";
import { useState } from "react";
import clsx from "clsx";
import {
  BarChart3,
  Users,
  ScrollText,
  TrendingUp,
  Download,
  DoorOpen,
  SmilePlus,
  Gavel,
  ShieldCheck,
  TerminalSquare,
  Clock,
  Mic,
  Settings,
  ChevronsUpDown,
  Menu,
} from "lucide-react";
import { useGuildQuery, GuildProvider } from "../lib/guild";
import { ApiError } from "../lib/api";
import type { ModuleName } from "../lib/types";
import { LoginScreen, GuildIcon, useMe } from "./ServerPicker";
import { Spinner } from "../components/ui";

type NavItem = { to: string; label: string; icon: React.ElementType; module?: ModuleName };
const sections: { title: string; items: NavItem[] }[] = [
  {
    title: "Rapporter",
    items: [
      { to: "", label: "Översikt", icon: BarChart3 },
      { to: "members", label: "Medlemmar", icon: Users },
      { to: "events", label: "Händelselogg", icon: ScrollText },
    ],
  },
  {
    title: "Moduler",
    items: [
      { to: "levels", label: "Levels", icon: TrendingUp, module: "levels" },
      { to: "welcome", label: "Välkomst", icon: DoorOpen, module: "welcome" },
      { to: "reaction-roles", label: "Reaction roles", icon: SmilePlus, module: "reactionRoles" },
      { to: "moderation", label: "Moderering", icon: Gavel, module: "moderation" },
      { to: "automod", label: "Automod", icon: ShieldCheck, module: "automod" },
      { to: "commands", label: "Egna kommandon", icon: TerminalSquare, module: "customCommands" },
      { to: "timers", label: "Schemalagda meddelanden", icon: Clock, module: "timers" },
      { to: "voice", label: "Skapa en kanal", icon: Mic, module: "tempVoice" },
    ],
  },
  {
    title: "Server",
    items: [
      { to: "import", label: "Importera från MEE6", icon: Download },
      { to: "settings", label: "Inställningar", icon: Settings },
    ],
  },
];

export function GuildLayout() {
  const { guildId = "" } = useParams();
  const q = useGuildQuery(guildId);
  const me = useMe();
  const [mobileOpen, setMobileOpen] = useState(false);

  if (q.error instanceof ApiError && q.error.status === 401) return <LoginScreen />;
  if (q.isLoading) return <div className="grid min-h-full place-items-center"><Spinner /></div>;
  if (!q.data)
    return (
      <div className="grid min-h-full place-items-center p-6 text-center">
        <div>
          <p className="text-muted">{q.error?.message ?? "Kunde inte ladda servern"}</p>
          <Link to="/" className="mt-4 inline-block text-accent-2 hover:underline">Tillbaka till serverlistan</Link>
        </div>
      </div>
    );

  const g = q.data;
  const sidebar = (
    <nav className="flex h-full flex-col">
      <Link to="/" className="m-3 flex items-center gap-3 rounded-lg border border-line bg-panel-2/50 p-2.5 transition hover:border-line-2">
        <GuildIcon id={g.id} icon={g.icon} name={g.name} size={34} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{g.name}</div>
          <div className="text-xs text-muted">{g.memberCount.toLocaleString("sv-SE")} medlemmar</div>
        </div>
        <ChevronsUpDown className="size-4 text-muted" />
      </Link>
      <div className="flex-1 space-y-5 overflow-y-auto px-3 pb-4">
        {sections.map((s) => (
          <div key={s.title}>
            <div className="px-2 pb-1.5 text-[11px] font-semibold tracking-wider text-faint uppercase">{s.title}</div>
            {s.items.map((it) => {
              const on = it.module ? g.modules[it.module]?.enabled : undefined;
              return (
                <NavLink
                  key={it.to}
                  to={it.to}
                  end={it.to === ""}
                  onClick={() => setMobileOpen(false)}
                  className={({ isActive }) =>
                    clsx(
                      "group flex items-center gap-2.5 rounded-md px-2 py-1.5 text-[13.5px] transition",
                      isActive ? "bg-accent/15 font-medium text-fg" : "text-muted hover:bg-panel-2 hover:text-fg",
                    )
                  }
                >
                  <it.icon className="size-4 shrink-0" />
                  <span className="flex-1 truncate">{it.label}</span>
                  {on !== undefined && <span className={clsx("size-1.5 rounded-full", on ? "bg-ok" : "bg-line-2")} title={on ? "På" : "Av"} />}
                </NavLink>
              );
            })}
          </div>
        ))}
      </div>
      {me.data && (
        <div className="flex items-center gap-2 border-t border-line px-4 py-3 text-xs text-muted">
          <span className="truncate">Inloggad som {me.data.user.username}</span>
        </div>
      )}
    </nav>
  );

  return (
    <GuildProvider guild={g}>
      <div className="flex min-h-full">
        <aside className="fixed inset-y-0 left-0 hidden w-64 border-r border-line bg-panel lg:block">{sidebar}</aside>
        {mobileOpen && (
          <div className="fixed inset-0 z-40 bg-black/60 lg:hidden" onClick={() => setMobileOpen(false)}>
            <aside className="h-full w-72 border-r border-line bg-panel" onClick={(e) => e.stopPropagation()}>
              {sidebar}
            </aside>
          </div>
        )}
        <main className="min-w-0 flex-1 lg:pl-64">
          <div className="sticky top-0 z-30 flex items-center gap-3 border-b border-line bg-bg/80 px-4 py-3 backdrop-blur lg:hidden">
            <button onClick={() => setMobileOpen(true)} className="text-muted">
              <Menu className="size-5" />
            </button>
            <span className="font-medium">{g.name}</span>
          </div>
          <div className="mx-auto max-w-6xl px-5 py-8 lg:px-10">
            <Outlet />
          </div>
        </main>
      </div>
    </GuildProvider>
  );
}
