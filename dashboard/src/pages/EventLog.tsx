import { useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { ScrollText } from "lucide-react";
import { api, avatarUrl, fmtDateTime } from "../lib/api";
import { useGuild } from "../lib/guild";
import { Button, Card, Empty, PageHeader, Select, Spinner } from "../components/ui";
import { useT, type TKey } from "../lib/i18n";

interface Ev {
  id: string;
  type: string;
  user_id: string | null;
  channel_id: string | null;
  data: Record<string, unknown>;
  created_at: string;
  display_name: string | null;
  avatar: string | null;
}

const TYPES = ["member_join", "member_leave", "voice_join", "voice_leave", "level_up", "mod_action", "automod"] as const;

type T = (key: TKey, params?: Record<string, string | number>) => string;

export function eventLabel(t: T, type: string, data: Record<string, unknown>) {
  if (type === "level_up") return t("dash.events.reachedLevel", { level: Number(data.level) });
  if (type === "mod_action") {
    const action = t(`moderation.actions.${String(data.action)}` as TKey);
    return data.reason ? `${action}: ${data.reason}` : action;
  }
  if (type === "automod") {
    // newer events store the rule key, older ones a ready-made label
    const rule = String(data.rule ?? "");
    const label = t(`automod.rules.${rule}` as TKey);
    return `Automod: ${label.startsWith("automod.") ? rule : label}`;
  }
  return (TYPES as readonly string[]).includes(type) ? t(`dash.events.types.${type}` as TKey) : type;
}

export function EventLog() {
  const g = useGuild();
  const { t } = useT();
  const [type, setType] = useState("");
  const q = useInfiniteQuery({
    queryKey: ["events", g.id, type],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => api<Ev[]>(`/guilds/${g.id}/reports/events?type=${type}&limit=100&before=${pageParam}`),
    getNextPageParam: (last) => (last.length === 100 ? Number(last[last.length - 1].id) : undefined),
  });
  const rows = q.data?.pages.flat() ?? [];
  const chan = (id: string | null) => (id ? g.channels.find((c) => c.id === id)?.name : null);

  return (
    <div>
      <PageHeader
        title={t("dash.events.title")}
        icon={<ScrollText className="size-5" />}
        description={t("dash.events.description")}
        actions={
          <div className="w-56">
            <Select
              value={type}
              onChange={setType}
              options={[{ value: "", label: t("dash.events.all") }, ...TYPES.map((value) => ({ value, label: t(`dash.events.types.${value}` as TKey) }))]}
            />
          </div>
        }
      />
      <Card padded={false}>
        {q.isLoading ? (
          <div className="grid h-40 place-items-center"><Spinner /></div>
        ) : rows.length === 0 ? (
          <Empty icon={<ScrollText className="size-5" />} title={t("dash.events.empty")} />
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((e) => (
              <li key={e.id} className="flex items-center gap-3 px-5 py-2.5 text-sm">
                {e.user_id ? <img src={avatarUrl(e.user_id, e.avatar)} className="size-7 rounded-full" alt="" /> : <div className="size-7" />}
                <div className="min-w-0 flex-1">
                  <span className="font-medium">{e.display_name ?? e.user_id ?? "—"}</span> <span className="text-muted">{eventLabel(t, e.type, e.data)}</span>
                  {chan(e.channel_id) && <span className="text-muted"> · #{chan(e.channel_id)}</span>}
                </div>
                <span className="shrink-0 text-xs text-muted">{fmtDateTime(e.created_at)}</span>
              </li>
            ))}
          </ul>
        )}
        {q.hasNextPage && (
          <div className="border-t border-line p-3 text-center">
            <Button size="sm" loading={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>{t("dash.common.loadMore")}</Button>
          </div>
        )}
      </Card>
    </div>
  );
}
