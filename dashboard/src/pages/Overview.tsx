import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { BarChart3, Hash, Volume2 } from "lucide-react";
import { api, avatarUrl, fmtHours, fmtNum } from "../lib/api";
import { useGuild } from "../lib/guild";
import { Card, PageHeader, Segmented, Spinner, Empty } from "../components/ui";
import { Heatmap, PairBars, Stat, TrendChart } from "../components/charts";

export const PERIODS = [
  { value: "7", label: "7 dagar" },
  { value: "30", label: "30 dagar" },
  { value: "90", label: "90 dagar" },
  { value: "365", label: "1 år" },
] as const;
export type Period = (typeof PERIODS)[number]["value"];

interface OverviewData {
  from: string;
  to: string;
  memberCount: number | null;
  totals: { messages: number; voice_seconds: number; active_users: number; joins: number; leaves: number; mod_actions: number };
  series: { day: string; messages: number; voice_seconds: number; active_users: number; joins: number; leaves: number; mod_actions: number }[];
  heatmap: { dow: number; hour: number; messages: number; voice_seconds: number }[];
  topMembers: { user_id: string; display_name: string; avatar: string | null; messages: number; voice_seconds: number }[];
  topChannels: { channel_id: string; messages: number; voice_seconds: number }[];
}

export function Overview() {
  const g = useGuild();
  const [days, setDays] = useState<Period>("30");
  const [heat, setHeat] = useState<"messages" | "voice_seconds">("messages");
  const q = useQuery({ queryKey: ["overview", g.id, days], queryFn: () => api<OverviewData>(`/guilds/${g.id}/reports/overview?days=${days}`) });
  const d = q.data;
  const chan = (id: string) => g.channels.find((c) => c.id === id);
  const voiceSeries = d?.series.map((s) => ({ ...s, voice_hours: Math.round((s.voice_seconds / 3600) * 10) / 10 }));

  return (
    <div>
      <PageHeader
        title="Översikt"
        icon={<BarChart3 className="size-5" />}
        description="Aktivitet på servern: meddelanden, röst, medlemsflöde och när folk är aktiva."
        actions={<Segmented value={days} onChange={setDays} options={[...PERIODS]} />}
      />
      {!g.modules.activity.enabled && (
        <div className="mb-5 rounded-lg border border-warn/30 bg-warn/10 px-4 py-3 text-sm text-amber-200">
          Aktivitetsspårning är avstängd. Slå på den under <Link to="../settings" className="underline">Inställningar</Link> för att samla in data.
        </div>
      )}
      {q.isLoading || !d ? (
        <div className="grid h-60 place-items-center"><Spinner /></div>
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Stat label="Meddelanden" value={fmtNum(d.totals.messages)} sub={`${fmtNum(Math.round(d.totals.messages / d.series.length))} per dag`} />
            <Stat label="Tid i röst" value={fmtHours(d.totals.voice_seconds)} />
            <Stat label="Aktiva medlemmar" value={fmtNum(d.totals.active_users)} sub={d.memberCount ? `av ${fmtNum(d.memberCount)}` : undefined} />
            <Stat label="Nya medlemmar" value={`+${fmtNum(d.totals.joins)}`} sub={`${fmtNum(d.totals.leaves)} lämnade`} />
            <Stat label="Moderering" value={fmtNum(d.totals.mod_actions)} sub="åtgärder och automod" />
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <Card title="Meddelanden per dag">
              <TrendChart data={d.series} dataKey="messages" name="Meddelanden" />
            </Card>
            <Card title="Aktiva medlemmar per dag" description="Skrev eller satt i röst minst en gång">
              <TrendChart data={d.series} dataKey="active_users" name="Aktiva" />
            </Card>
            <Card title="Timmar i röstkanaler per dag">
              <TrendChart data={voiceSeries!} dataKey="voice_hours" name="Röst" format={(v) => `${v.toLocaleString("sv-SE")} h`} />
            </Card>
            <Card title="Medlemsflöde">
              <PairBars data={d.series} a={{ key: "joins", name: "Gick med" }} b={{ key: "leaves", name: "Lämnade" }} />
            </Card>
          </div>

          <Card
            title="När är servern aktiv?"
            description="Veckodag × timme (svensk tid)"
            actions={<Segmented value={heat} onChange={setHeat} options={[{ value: "messages", label: "Meddelanden" }, { value: "voice_seconds", label: "Röst" }]} />}
          >
            <Heatmap cells={d.heatmap} metric={heat} />
          </Card>

          <div className="grid gap-5 lg:grid-cols-2">
            <Card title="Mest aktiva medlemmar" actions={<Link to="../members" className="text-[13px] text-accent-2 hover:underline">Visa alla</Link>} padded={false}>
              {d.topMembers.length === 0 ? (
                <Empty title="Ingen aktivitet ännu" />
              ) : (
                <ul className="divide-y divide-line">
                  {d.topMembers.map((m, i) => (
                    <li key={m.user_id} className="flex items-center gap-3 px-5 py-2.5">
                      <span className="w-4 text-sm text-faint tabular-nums">{i + 1}</span>
                      <img src={avatarUrl(m.user_id, m.avatar)} className="size-7 rounded-full" alt="" />
                      <span className="flex-1 truncate text-sm">{m.display_name || m.user_id}</span>
                      <span className="text-sm text-muted tabular-nums">{fmtNum(m.messages)} medd.</span>
                      <span className="w-16 text-right text-sm text-muted tabular-nums">{fmtHours(m.voice_seconds)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card title="Mest aktiva kanaler" padded={false}>
              {d.topChannels.length === 0 ? (
                <Empty title="Ingen aktivitet ännu" />
              ) : (
                <ul className="divide-y divide-line">
                  {d.topChannels.map((c) => {
                    const ch = chan(c.channel_id);
                    const voice = ch?.type === "voice";
                    return (
                      <li key={c.channel_id} className="flex items-center gap-3 px-5 py-2.5">
                        {voice ? <Volume2 className="size-4 text-muted" /> : <Hash className="size-4 text-muted" />}
                        <span className="flex-1 truncate text-sm">{ch?.name ?? "borttagen kanal"}</span>
                        <span className="text-sm text-muted tabular-nums">{voice ? fmtHours(c.voice_seconds) : `${fmtNum(c.messages)} medd.`}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
