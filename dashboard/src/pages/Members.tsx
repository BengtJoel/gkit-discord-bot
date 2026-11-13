import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { ArrowDown, ArrowUp, Download, Search, Users } from "lucide-react";
import { api, avatarUrl, fmtDate, fmtDateTime, fmtHours, fmtNum, timeAgo } from "../lib/api";
import { useGuild } from "../lib/guild";
import { Badge, Button, Card, Drawer, Empty, PageHeader, Segmented, Spinner } from "../components/ui";
import { TrendChart } from "../components/charts";
import { usePeriods, type Period } from "./Overview";
import { useT, type TKey } from "../lib/i18n";
import { eventLabel } from "./EventLog";

interface Row {
  user_id: string;
  display_name: string;
  username: string;
  avatar: string | null;
  joined_at: string | null;
  left_at: string | null;
  last_seen: string | null;
  messages: number;
  voice_seconds: number;
  reactions: number;
  commands: number;
  active_days: number;
  xp: number;
}

const COLS: { key: string; label: TKey; align?: "right" }[] = [
  { key: "name", label: "dash.members.cols.member" },
  { key: "messages", label: "dash.members.cols.messages", align: "right" },
  { key: "voice", label: "dash.members.cols.voice", align: "right" },
  { key: "reactions", label: "dash.members.cols.reactions", align: "right" },
  { key: "activeDays", label: "dash.members.cols.activeDays", align: "right" },
  { key: "lastSeen", label: "dash.members.cols.lastSeen", align: "right" },
  { key: "joined", label: "dash.members.cols.joined", align: "right" },
];

export function Members() {
  const g = useGuild();
  const { t, lang } = useT();
  const periods = usePeriods();
  const [days, setDays] = useState<Period>("30");
  const [status, setStatus] = useState<"current" | "inactive" | "left" | "all">("current");
  const [sort, setSort] = useState("messages");
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 250);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => setPage(0), [days, status, sort, dir, debounced]);

  const params = new URLSearchParams({ days, status, sort, dir, search: debounced, page: String(page), limit: "50" });
  const q = useQuery({
    queryKey: ["members", g.id, params.toString()],
    queryFn: () => api<{ total: number; rows: Row[] }>(`/guilds/${g.id}/reports/members?${params}`),
    placeholderData: (prev) => prev,
  });

  const toggleSort = (k: string) => {
    if (sort === k) setDir(dir === "desc" ? "asc" : "desc");
    else {
      setSort(k);
      setDir(k === "name" ? "asc" : "desc");
    }
  };
  const total = q.data?.total ?? 0;

  return (
    <div>
      <PageHeader
        title={t("dash.members.title")}
        icon={<Users className="size-5" />}
        description={t("dash.members.description", { days: g.modules.activity.config.inactiveDays })}
        actions={
          <a href={`/api/guilds/${g.id}/reports/members.csv?${params}&lang=${lang}`}>
            <Button icon={<Download className="size-4" />}>{t("dash.members.exportCsv")}</Button>
          </a>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative w-64">
          <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
          <input className="input pl-9" placeholder={t("dash.members.searchPlaceholder")} value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Segmented
          value={status}
          onChange={setStatus}
          options={[
            { value: "current", label: t("dash.members.status.current") },
            { value: "inactive", label: t("dash.members.status.inactive") },
            { value: "left", label: t("dash.members.status.left") },
            { value: "all", label: t("dash.members.status.all") },
          ]}
        />
        <div className="ml-auto">
          <Segmented value={days} onChange={setDays} options={periods} />
        </div>
      </div>

      <Card padded={false}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-[12px] text-muted">
                {COLS.map((c) => (
                  <th key={c.key} className={clsx("px-4 py-2.5 font-medium whitespace-nowrap", c.align === "right" && "text-right")}>
                    <button onClick={() => toggleSort(c.key)} className={clsx("inline-flex items-center gap-1 hover:text-fg", sort === c.key && "text-fg")}>
                      {t(c.label)}
                      {sort === c.key && (dir === "desc" ? <ArrowDown className="size-3" /> : <ArrowUp className="size-3" />)}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {q.data?.rows.map((r) => (
                <tr key={r.user_id} onClick={() => setOpen(r.user_id)} className="cursor-pointer transition hover:bg-panel-2/60">
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-3">
                      <img src={avatarUrl(r.user_id, r.avatar)} className="size-7 rounded-full" alt="" />
                      <div className="min-w-0">
                        <div className="truncate font-medium">{r.display_name || r.username || r.user_id}</div>
                        {r.username && r.username !== r.display_name && <div className="truncate text-xs text-muted">@{r.username}</div>}
                      </div>
                      {r.left_at && <Badge tone="bad">{t("dash.members.leftBadge")}</Badge>}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{fmtNum(r.messages)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{fmtHours(r.voice_seconds)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{fmtNum(r.reactions)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{r.active_days}</td>
                  <td className="px-4 py-2.5 text-right whitespace-nowrap text-muted" title={fmtDateTime(r.last_seen)}>
                    {timeAgo(r.last_seen)}
                  </td>
                  <td className="px-4 py-2.5 text-right whitespace-nowrap text-muted">{fmtDate(r.joined_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {q.isLoading && <div className="grid h-40 place-items-center"><Spinner /></div>}
          {q.data && q.data.rows.length === 0 && <Empty icon={<Users className="size-5" />} title={t("dash.members.noMatch")} />}
        </div>
        {total > 50 && (
          <div className="flex items-center justify-between border-t border-line px-4 py-3 text-sm text-muted">
            <span>{t("dash.common.range", { from: page * 50 + 1, to: Math.min((page + 1) * 50, total), total: fmtNum(total) })}</span>
            <div className="flex gap-2">
              <Button size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>{t("dash.common.previous")}</Button>
              <Button size="sm" disabled={(page + 1) * 50 >= total} onClick={() => setPage(page + 1)}>{t("dash.common.next")}</Button>
            </div>
          </div>
        )}
      </Card>

      <MemberDrawer userId={open} days={days} onClose={() => setOpen(null)} />
    </div>
  );
}

interface MemberDetail {
  member: { user_id: string; username?: string; display_name?: string; avatar?: string | null; joined_at?: string; left_at?: string; last_message_at?: string; last_voice_at?: string };
  roles: { id: string; name: string; color: string }[];
  level: { xp: number; level: number; current: number; needed: number; messageCount: number } | null;
  series: { day: string; messages: number; voice_seconds: number; reactions: number }[];
  events: { id: string; type: string; channel_id: string | null; data: Record<string, unknown>; created_at: string }[];
  cases: { case_number: number; action: string; reason: string; moderator_tag: string; created_at: string }[];
}

function MemberDrawer({ userId, days, onClose }: { userId: string | null; days: string; onClose: () => void }) {
  const g = useGuild();
  const { t } = useT();
  const q = useQuery({
    enabled: !!userId,
    queryKey: ["member", g.id, userId, days],
    queryFn: () => api<MemberDetail>(`/guilds/${g.id}/reports/members/${userId}?days=${days}`),
  });
  const d = q.data;
  const totals = d?.series.reduce((a, s) => ({ m: a.m + s.messages, v: a.v + s.voice_seconds }), { m: 0, v: 0 });
  const chanName = (id: string | null) => (id ? g.channels.find((c) => c.id === id)?.name : null);

  return (
    <Drawer open={!!userId} onClose={onClose} title={t("dash.members.drawerTitle")}>
      {!d ? (
        <div className="grid h-40 place-items-center"><Spinner /></div>
      ) : (
        <div className="space-y-6">
          <div className="flex items-center gap-4">
            <img src={avatarUrl(d.member.user_id, d.member.avatar, 128)} className="size-14 rounded-full" alt="" />
            <div>
              <div className="text-lg font-semibold">{d.member.display_name || d.member.username || d.member.user_id}</div>
              <div className="text-sm text-muted">
                @{d.member.username} · <span className="font-mono text-xs">{d.member.user_id}</span>
              </div>
            </div>
          </div>
          {d.roles.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {d.roles.map((r) => (
                <span key={r.id} className="inline-flex items-center gap-1.5 rounded-full border border-line-2 px-2 py-0.5 text-xs">
                  <span className="size-2 rounded-full" style={{ background: r.color === "#000000" ? "#8b8b96" : r.color }} />
                  {r.name}
                </span>
              ))}
            </div>
          )}
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <Info label={t("dash.members.cols.joined")} value={fmtDate(d.member.joined_at)} />
            <Info label={t("dash.members.lastMessage")} value={timeAgo(d.member.last_message_at)} />
            <Info label={t("dash.members.lastVoice")} value={timeAgo(d.member.last_voice_at)} />
            <Info label={t("dash.members.level")} value={d.level ? `${d.level.level} (${fmtNum(d.level.xp)} XP)` : "—"} />
            <Info label={t("dash.members.messagesIn", { days })} value={fmtNum(totals?.m)} />
            <Info label={t("dash.members.voiceIn", { days })} value={fmtHours(totals?.v ?? 0)} />
          </dl>
          <div>
            <h3 className="mb-2 text-sm font-semibold">{t("dash.overview.messagesPerDay")}</h3>
            <TrendChart data={d.series} dataKey="messages" name={t("dash.overview.messages")} height={160} />
          </div>
          {d.cases.length > 0 && (
            <div>
              <h3 className="mb-2 text-sm font-semibold">{t("dash.overview.moderation")}</h3>
              <ul className="space-y-1.5 text-sm">
                {d.cases.map((c) => (
                  <li key={c.case_number} className="rounded-md border border-line px-3 py-2">
                    <span className="font-medium">#{c.case_number} {t(`moderation.actions.${c.action}` as TKey)}</span> · <span className="text-muted">{t("dash.members.caseBy", { date: fmtDate(c.created_at), by: c.moderator_tag })}</span>
                    {c.reason && <div className="text-muted">{c.reason}</div>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div>
            <h3 className="mb-2 text-sm font-semibold">{t("dash.members.recentEvents")}</h3>
            {d.events.length === 0 ? (
              <p className="text-sm text-muted">{t("dash.members.noEvents")}</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {d.events.map((e) => (
                  <li key={e.id} className="flex justify-between gap-3 border-b border-line/60 py-1.5">
                    <span>
                      {eventLabel(t, e.type, e.data)}
                      {chanName(e.channel_id) && <span className="text-muted"> · #{chanName(e.channel_id)}</span>}
                    </span>
                    <span className="shrink-0 text-muted">{fmtDateTime(e.created_at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </Drawer>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-line bg-panel-2/40 px-3 py-2">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 font-medium">{value}</dd>
    </div>
  );
}
