import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock, Pencil, Plus, Send, Trash2 } from "lucide-react";
import { api, fmtDateTime } from "../lib/api";
import { useGuild, useModuleForm } from "../lib/guild";
import { ModuleShell } from "../components/ModuleShell";
import { Badge, Button, Card, ChannelSelect, Empty, Field, Modal, Segmented, Spinner, Toggle, useToast } from "../components/ui";
import { useT, tr, currentLocale } from "../lib/i18n";

interface Timer {
  id?: number;
  name: string;
  channelId: string;
  content: string;
  cron: string;
  timezone: string;
  enabled: boolean;
  lastRunAt?: string | null;
  nextRunAt?: string | null;
}

/** Monday-first, cron day numbers (0 = Sunday), names in the current language */
const days = () =>
  [1, 2, 3, 4, 5, 6, 0].map((v) => ({
    v,
    l: new Date(Date.UTC(2024, 0, v === 0 ? 7 : v, 12)).toLocaleDateString(currentLocale(), { weekday: "short", timeZone: "UTC" }),
  }));

/** Simple builder for the common cases; anything else falls back to raw cron */
type Simple = { kind: "weekly"; days: number[]; time: string } | { kind: "hourly"; every: number } | { kind: "cron" };

function parseCron(cron: string): Simple {
  const p = cron.trim().split(/\s+/);
  if (p.length === 5 && /^\d+$/.test(p[0]) && /^\d+$/.test(p[1]) && p[2] === "*" && p[3] === "*") {
    const days = p[4] === "*" ? [0, 1, 2, 3, 4, 5, 6] : p[4].split(",").map(Number);
    if (days.every((d) => d >= 0 && d <= 6)) return { kind: "weekly", days, time: `${p[1].padStart(2, "0")}:${p[0].padStart(2, "0")}` };
  }
  const h = p.length === 5 && p[0] === "0" && p[1].match(/^\*\/(\d+)$/);
  if (h && p.slice(2).every((x) => x === "*")) return { kind: "hourly", every: Number(h[1]) };
  return { kind: "cron" };
}
function toCron(s: Simple, fallback: string) {
  if (s.kind === "weekly") {
    const [hh, mm] = s.time.split(":").map(Number);
    const days = s.days.length === 7 || s.days.length === 0 ? "*" : [...s.days].sort().join(",");
    return `${mm} ${hh} * * ${days}`;
  }
  if (s.kind === "hourly") return `0 */${s.every} * * *`;
  return fallback;
}
function describe(cron: string) {
  const s = parseCron(cron);
  if (s.kind === "weekly")
    return s.days.length === 7
      ? tr("dash.timers.everyDayAt", { time: s.time })
      : tr("dash.timers.daysAt", { days: days().filter((d) => s.days.includes(d.v)).map((d) => d.l).join(", "), time: s.time });
  if (s.kind === "hourly") return tr("dash.timers.everyNHours", { count: s.every });
  return cron;
}

export function Timers() {
  const f = useModuleForm("timers");
  const g = useGuild();
  const { t } = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const [draft, setDraft] = useState<Timer | null>(null);
  const list = useQuery({ queryKey: ["timers", g.id], queryFn: () => api<Timer[]>(`/guilds/${g.id}/timers`) });
  const inval = () => void qc.invalidateQueries({ queryKey: ["timers", g.id] });
  const save = useMutation({
    mutationFn: (t: Timer) => (t.id ? api(`/guilds/${g.id}/timers/${t.id}`, { method: "PUT", json: t }) : api(`/guilds/${g.id}/timers`, { method: "POST", json: t })),
    onSuccess: () => {
      toast(t("dash.timers.saved"));
      setDraft(null);
      inval();
    },
    onError: (e: Error) => toast(e.message, "bad"),
  });
  const del = useMutation({ mutationFn: (id: number) => api(`/guilds/${g.id}/timers/${id}`, { method: "DELETE" }), onSuccess: inval });
  const test = useMutation({
    mutationFn: (id: number) => api(`/guilds/${g.id}/timers/${id}/test`, { method: "POST" }),
    onSuccess: () => toast(t("dash.timers.sent")),
    onError: (e: Error) => toast(e.message, "bad"),
  });
  const chan = (id: string) => g.channels.find((c) => c.id === id)?.name ?? t("dash.common.unknownChannel");

  return (
    <ModuleShell
      title={t("dash.nav.timers")}
      icon={<Clock className="size-5" />}
      description={t("dash.timers.description")}
      form={f}
      actions={
        <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setDraft({ name: "", channelId: "", content: "", cron: "45 18 * * 3", timezone: "Europe/Stockholm", enabled: true })}>
          {t("dash.timers.new")}
        </Button>
      }
    >
      <Card padded={false}>
        {list.isLoading ? (
          <div className="grid h-32 place-items-center"><Spinner /></div>
        ) : !list.data?.length ? (
          <Empty icon={<Clock className="size-5" />} title={t("dash.timers.empty")} />
        ) : (
          <ul className="divide-y divide-line">
            {list.data.map((timer) => (
              <li key={timer.id} className="flex items-center gap-4 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{timer.name || describe(timer.cron)}</span>
                    {!timer.enabled && <Badge>{t("dash.timers.paused")}</Badge>}
                  </div>
                  <div className="truncate text-sm text-muted">
                    #{chan(timer.channelId)} · {describe(timer.cron)} · {timer.content}
                  </div>
                </div>
                <div className="hidden text-right text-xs text-muted sm:block">
                  <div>{t("dash.timers.next")}: {timer.enabled && timer.nextRunAt ? fmtDateTime(timer.nextRunAt) : "—"}</div>
                  <div>{t("dash.timers.last")}: {fmtDateTime(timer.lastRunAt)}</div>
                </div>
                <Button variant="ghost" size="sm" title={t("dash.timers.sendNow")} onClick={() => test.mutate(timer.id!)}><Send className="size-4" /></Button>
                <Button variant="ghost" size="sm" onClick={() => setDraft(timer)}><Pencil className="size-4" /></Button>
                <Button variant="ghost" size="sm" onClick={() => confirm(t("dash.timers.confirmDelete")) && del.mutate(timer.id!)}><Trash2 className="size-4" /></Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {draft && <TimerEditor draft={draft} setDraft={setDraft} saving={save.isPending} onSave={() => save.mutate(draft)} />}
    </ModuleShell>
  );
}

function TimerEditor({ draft, setDraft, onSave, saving }: { draft: Timer; setDraft: (t: Timer | null) => void; onSave: () => void; saving: boolean }) {
  const g = useGuild();
  const { t } = useT();
  const [simple, setSimple] = useState<Simple>(() => parseCron(draft.cron));
  const [preview, setPreview] = useState<{ runs?: string[]; error?: string }>({});
  const cron = toCron(simple, draft.cron);

  useEffect(() => {
    if (cron !== draft.cron) setDraft({ ...draft, cron });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cron]);
  useEffect(() => {
    const t = setTimeout(() => {
      api<{ runs: string[] }>(`/guilds/${g.id}/timers/preview`, { method: "POST", json: { cron: draft.cron, timezone: draft.timezone } })
        .then((r) => setPreview({ runs: r.runs }))
        .catch((e: Error) => setPreview({ error: e.message }));
    }, 300);
    return () => clearTimeout(t);
  }, [draft.cron, draft.timezone, g.id]);

  return (
    <Modal
      open
      wide
      onClose={() => setDraft(null)}
      title={draft.id ? t("dash.timers.editTitle") : t("dash.timers.new")}
      footer={
        <>
          <Button variant="ghost" onClick={() => setDraft(null)}>{t("dash.common.cancel")}</Button>
          <Button variant="primary" loading={saving} disabled={!draft.channelId || !draft.content || !!preview.error} onClick={onSave}>{t("dash.common.save")}</Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("dash.timers.nameOptional")}><input className="input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder={t("dash.timers.namePlaceholder")} /></Field>
        <Field label={t("dash.common.channel")}><ChannelSelect value={draft.channelId || null} onChange={(v) => setDraft({ ...draft, channelId: v ?? "" })} clearable={false} /></Field>
      </div>
      <Field label={t("dash.common.message")} hint={t("dash.timers.pingHint")}>
        <textarea className="input" rows={4} value={draft.content} onChange={(e) => setDraft({ ...draft, content: e.target.value })} />
      </Field>
      <Field label={t("dash.timers.when")}>
        <Segmented
          value={simple.kind}
          onChange={(k) => setSimple(k === "weekly" ? { kind: "weekly", days: [3], time: "18:45" } : k === "hourly" ? { kind: "hourly", every: 6 } : { kind: "cron" })}
          options={[{ value: "weekly", label: t("dash.timers.kinds.weekly") }, { value: "hourly", label: t("dash.timers.kinds.hourly") }, { value: "cron", label: t("dash.timers.kinds.cron") }]}
        />
      </Field>
      {simple.kind === "weekly" && (
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex gap-1">
            {days().map((d) => {
              const on = simple.days.includes(d.v);
              return (
                <button
                  key={d.v}
                  type="button"
                  onClick={() => setSimple({ ...simple, days: on ? simple.days.filter((x) => x !== d.v) : [...simple.days, d.v] })}
                  className={`h-9 w-11 rounded-md border text-sm font-medium transition ${on ? "border-accent bg-accent/20 text-fg" : "border-line bg-panel-2 text-muted hover:text-fg"}`}
                >
                  {d.l}
                </button>
              );
            })}
          </div>
          <input type="time" className="input w-32" value={simple.time} onChange={(e) => setSimple({ ...simple, time: e.target.value })} />
        </div>
      )}
      {simple.kind === "hourly" && (
        <div className="flex items-center gap-2 text-sm">
          {t("dash.timers.every")}
          <input type="number" min={1} max={23} className="input w-20" value={simple.every} onChange={(e) => setSimple({ kind: "hourly", every: Math.max(1, Number(e.target.value)) })} />
          {t("dash.timers.hours")}
        </div>
      )}
      {simple.kind === "cron" && <input className="input font-mono" value={draft.cron} onChange={(e) => setDraft({ ...draft, cron: e.target.value })} placeholder={t("dash.timers.cronPlaceholder")} />}
      <div className="rounded-lg border border-line bg-panel-2/40 px-4 py-3 text-sm">
        {preview.error ? (
          <span className="text-red-300">{preview.error}</span>
        ) : (
          <>
            <span className="text-muted">{t("dash.timers.nextRuns")}: </span>
            {preview.runs?.map((r) => fmtDateTime(r)).join(" · ") ?? "…"}
          </>
        )}
      </div>
      <label className="flex items-center gap-3 text-sm"><Toggle size="sm" checked={draft.enabled} onChange={(enabled) => setDraft({ ...draft, enabled })} /> {t("dash.common.active")}</label>
    </Modal>
  );
}
