import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { BarChart3, Hash, Volume2 } from "lucide-react";
import { api, avatarUrl, fmtHours, fmtNum } from "../lib/api";
import { useGuild } from "../lib/guild";
import { Card, PageHeader, Segmented, Spinner, Empty } from "../components/ui";
import { Heatmap, PairBars, Stat, TrendChart } from "../components/charts";
import { useT } from "../lib/i18n";

export type Period = "7" | "30" | "90" | "365";
export function usePeriods() {
  const { t } = useT();
  return [
    { value: "7" as Period, label: t("dash.periods.days", { count: 7 }) },
    { value: "30" as Period, label: t("dash.periods.days", { count: 30 }) },
    { value: "90" as Period, label: t("dash.periods.days", { count: 90 }) },
    { value: "365" as Period, label: t("dash.periods.year") },
  ];
}

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
  const { t } = useT();
  const periods = usePeriods();
  const [days, setDays] = useState<Period>("30");
  const [heat, setHeat] = useState<"messages" | "voice_seconds">("messages");
  const q = useQuery({ queryKey: ["overview", g.id, days], queryFn: () => api<OverviewData>(`/guilds/${g.id}/reports/overview?days=${days}`) });
  const d = q.data;
  const chan = (id: string) => g.channels.find((c) => c.id === id);
  const voiceSeries = d?.series.map((s) => ({ ...s, voice_hours: Math.round((s.voice_seconds / 3600) * 10) / 10 }));

  return (
    <div>
      <PageHeader
        title={t("dash.overview.title")}
        icon={<BarChart3 className="size-5" />}
        description={t("dash.overview.description")}
        actions={<Segmented value={days} onChange={setDays} options={periods} />}
      />
      {!g.modules.activity.enabled && (
        <div className="mb-5 rounded-lg border border-warn/30 bg-warn/10 px-4 py-3 text-sm text-amber-200">
          {t("dash.overview.trackingOff")} <Link to="../settings" className="underline">{t("dash.nav.settings")}</Link>
        </div>
      )}
      {q.isLoading || !d ? (
        <div className="grid h-60 place-items-center"><Spinner /></div>
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Stat label={t("dash.overview.messages")} value={fmtNum(d.totals.messages)} sub={t("dash.overview.perDay", { n: fmtNum(Math.round(d.totals.messages / d.series.length)) })} />
            <Stat label={t("dash.overview.voiceTime")} value={fmtHours(d.totals.voice_seconds)} />
            <Stat label={t("dash.overview.activeMembers")} value={fmtNum(d.totals.active_users)} sub={d.memberCount ? t("dash.overview.ofTotal", { n: fmtNum(d.memberCount) }) : undefined} />
            <Stat label={t("dash.overview.newMembers")} value={`+${fmtNum(d.totals.joins)}`} sub={t("dash.overview.left", { n: fmtNum(d.totals.leaves) })} />
            <Stat label={t("dash.overview.moderation")} value={fmtNum(d.totals.mod_actions)} sub={t("dash.overview.moderationSub")} />
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <Card title={t("dash.overview.messagesPerDay")}>
              <TrendChart data={d.series} dataKey="messages" name={t("dash.overview.messages")} />
            </Card>
            <Card title={t("dash.overview.activePerDay")} description={t("dash.overview.activePerDayHint")}>
              <TrendChart data={d.series} dataKey="active_users" name={t("dash.overview.active")} />
            </Card>
            <Card title={t("dash.overview.voicePerDay")}>
              <TrendChart data={voiceSeries!} dataKey="voice_hours" name={t("dash.overview.voice")} format={(v) => `${fmtNum(v)} h`} />
            </Card>
            <Card title={t("dash.overview.memberFlow")}>
              <PairBars data={d.series} a={{ key: "joins", name: t("dash.overview.joined") }} b={{ key: "leaves", name: t("dash.overview.leftLabel") }} />
            </Card>
          </div>

          <Card
            title={t("dash.overview.whenActive")}
            description={t("dash.overview.whenActiveHint")}
            actions={<Segmented value={heat} onChange={setHeat} options={[{ value: "messages", label: t("dash.overview.messages") }, { value: "voice_seconds", label: t("dash.overview.voice") }]} />}
          >
            <Heatmap cells={d.heatmap} metric={heat} />
          </Card>

          <div className="grid gap-5 lg:grid-cols-2">
            <Card title={t("dash.overview.topMembers")} actions={<Link to="../members" className="text-[13px] text-accent-2 hover:underline">{t("dash.common.showAll")}</Link>} padded={false}>
              {d.topMembers.length === 0 ? (
                <Empty title={t("dash.overview.noActivity")} />
              ) : (
                <ul className="divide-y divide-line">
                  {d.topMembers.map((m, i) => (
                    <li key={m.user_id} className="flex items-center gap-3 px-5 py-2.5">
                      <span className="w-4 text-sm text-faint tabular-nums">{i + 1}</span>
                      <img src={avatarUrl(m.user_id, m.avatar)} className="size-7 rounded-full" alt="" />
                      <span className="flex-1 truncate text-sm">{m.display_name || m.user_id}</span>
                      <span className="text-sm text-muted tabular-nums">{t("dash.overview.msgShort", { n: fmtNum(m.messages) })}</span>
                      <span className="w-16 text-right text-sm text-muted tabular-nums">{fmtHours(m.voice_seconds)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card title={t("dash.overview.topChannels")} padded={false}>
              {d.topChannels.length === 0 ? (
                <Empty title={t("dash.overview.noActivity")} />
              ) : (
                <ul className="divide-y divide-line">
                  {d.topChannels.map((c) => {
                    const ch = chan(c.channel_id);
                    const voice = ch?.type === "voice";
                    return (
                      <li key={c.channel_id} className="flex items-center gap-3 px-5 py-2.5">
                        {voice ? <Volume2 className="size-4 text-muted" /> : <Hash className="size-4 text-muted" />}
                        <span className="flex-1 truncate text-sm">{ch?.name ?? t("dash.common.deletedChannel")}</span>
                        <span className="text-sm text-muted tabular-nums">{voice ? fmtHours(c.voice_seconds) : t("dash.overview.msgShort", { n: fmtNum(c.messages) })}</span>
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
