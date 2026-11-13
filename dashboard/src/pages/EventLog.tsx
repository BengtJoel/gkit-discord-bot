import { useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { ScrollText } from "lucide-react";
import { api, avatarUrl, fmtDateTime } from "../lib/api";
import { useGuild } from "../lib/guild";
import { Button, Card, Empty, PageHeader, Select, Spinner } from "../components/ui";

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

const LABELS: Record<string, string> = {
  member_join: "Gick med i servern",
  member_leave: "Lämnade servern",
  voice_join: "Gick in i röstkanal",
  voice_leave: "Lämnade röstkanal",
  level_up: "Gick upp i level",
  mod_action: "Moderering",
  automod: "Automod",
};

export function eventLabel(type: string, data: Record<string, unknown>) {
  if (type === "level_up") return `Nådde level ${data.level}`;
  if (type === "mod_action") return `${String(data.action ?? "").toUpperCase()}${data.reason ? `: ${data.reason}` : ""}`;
  if (type === "automod") return `Automod: ${data.rule}`;
  return LABELS[type] ?? type;
}

export function EventLog() {
  const g = useGuild();
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
        title="Händelselogg"
        icon={<ScrollText className="size-5" />}
        description="Allt som har hänt: in/ut ur servern, röstkanaler, levels och moderering. Själva meddelandena sparas inte, bara räknas."
        actions={
          <div className="w-56">
            <Select
              value={type}
              onChange={setType}
              options={[{ value: "", label: "Alla händelser" }, ...Object.entries(LABELS).map(([value, label]) => ({ value, label }))]}
            />
          </div>
        }
      />
      <Card padded={false}>
        {q.isLoading ? (
          <div className="grid h-40 place-items-center"><Spinner /></div>
        ) : rows.length === 0 ? (
          <Empty icon={<ScrollText className="size-5" />} title="Inga händelser ännu" />
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((e) => (
              <li key={e.id} className="flex items-center gap-3 px-5 py-2.5 text-sm">
                {e.user_id ? <img src={avatarUrl(e.user_id, e.avatar)} className="size-7 rounded-full" alt="" /> : <div className="size-7" />}
                <div className="min-w-0 flex-1">
                  <span className="font-medium">{e.display_name ?? e.user_id ?? "—"}</span> <span className="text-muted">{eventLabel(e.type, e.data)}</span>
                  {chan(e.channel_id) && <span className="text-muted"> · #{chan(e.channel_id)}</span>}
                </div>
                <span className="shrink-0 text-xs text-muted">{fmtDateTime(e.created_at)}</span>
              </li>
            ))}
          </ul>
        )}
        {q.hasNextPage && (
          <div className="border-t border-line p-3 text-center">
            <Button size="sm" loading={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>Ladda fler</Button>
          </div>
        )}
      </Card>
    </div>
  );
}
