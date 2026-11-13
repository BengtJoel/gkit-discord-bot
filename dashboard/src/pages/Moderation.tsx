import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Gavel, Plus, Search, Trash2 } from "lucide-react";
import { api, fmtDateTime } from "../lib/api";
import { useGuild, useModuleForm } from "../lib/guild";
import { ModuleShell } from "../components/ModuleShell";
import { Badge, Button, Card, ChannelSelect, Empty, Field, NumberInput, RoleMultiSelect, Select, Spinner, Toggle } from "../components/ui";
import { useT, type TKey } from "../lib/i18n";

interface Case {
  id: number;
  caseNumber: number;
  userId: string;
  userTag: string;
  moderatorTag: string;
  action: string;
  reason: string;
  durationSeconds: number | null;
  createdAt: string;
}
const ACTION: Record<string, "warn" | "bad" | "ok" | "accent" | "neutral"> = {
  warn: "warn",
  automod: "accent",
  timeout: "warn",
  kick: "bad",
  ban: "bad",
  tempban: "bad",
  unban: "ok",
};
const actionLabel = (t: (k: TKey) => string, a: string) => t(`moderation.actions.${a}` as TKey);

export function Moderation() {
  const { t } = useT();
  const f = useModuleForm("moderation");
  const d = f.draft;
  return (
    <ModuleShell
      title={t("dash.nav.moderation")}
      icon={<Gavel className="size-5" />}
      description={
        <>
          {t("dash.moderation.commands")} <span className="kbd">/warn</span> <span className="kbd">/timeout</span> <span className="kbd">/kick</span> <span className="kbd">/ban</span>{" "}
          <span className="kbd">/unban</span> <span className="kbd">/purge</span> <span className="kbd">/cases</span>. {t("dash.moderation.allLogged")}
        </>
      }
      form={f}
    >
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title={t("dash.moderation.logAndDm")}>
          <div className="space-y-4">
            <Field label={t("dash.moderation.logChannel")} hint={t("dash.moderation.logChannelHint")}>
              <ChannelSelect value={d.logChannelId} onChange={(v) => f.update("logChannelId", v)} />
            </Field>
            <div className="flex items-center justify-between rounded-lg border border-line px-4 py-3">
              <div>
                <div className="text-sm font-medium">{t("dash.moderation.dm")}</div>
                <div className="text-[13px] text-muted">{t("dash.moderation.dmHint")}</div>
              </div>
              <Toggle checked={d.dmOnAction} onChange={(v) => f.update("dmOnAction", v)} />
            </div>
            <Field label={t("dash.moderation.immune")} hint={t("dash.moderation.immuneHint")}>
              <RoleMultiSelect value={d.immuneRoleIds} onChange={(v) => f.update("immuneRoleIds", v)} />
            </Field>
          </div>
        </Card>
        <Card
          title={t("dash.moderation.escalation")}
          description={t("dash.moderation.escalationHint")}
          actions={
            <Button size="sm" icon={<Plus className="size-4" />} onClick={() => f.update("warnThresholds", [...d.warnThresholds, { count: (d.warnThresholds.at(-1)?.count ?? 0) + 3, action: "timeout", durationMinutes: 60 }])}>
              {t("dash.common.add")}
            </Button>
          }
        >
          {d.warnThresholds.length === 0 ? (
            <p className="text-sm text-muted">{t("dash.moderation.noEscalation")}</p>
          ) : (
            <div className="space-y-2">
              {d.warnThresholds.map((step, i) => {
                const upd = (p: Partial<typeof step>) => f.update("warnThresholds", d.warnThresholds.map((x, j) => (j === i ? { ...x, ...p } : x)));
                return (
                  <div key={i} className="flex items-center gap-2 text-sm">
                    <span className="text-muted">{t("dash.moderation.at")}</span>
                    <div className="w-20"><NumberInput value={step.count} min={1} onChange={(count) => upd({ count })} /></div>
                    <span className="text-muted">{t("dash.moderation.warningsArrow")}</span>
                    <div className="w-32">
                      <Select
                        value={step.action}
                        onChange={(action) => upd({ action })}
                        options={(["timeout", "kick", "ban"] as const).map((value) => ({ value, label: actionLabel(t, value) }))}
                      />
                    </div>
                    {step.action === "timeout" && <div className="w-28"><NumberInput value={step.durationMinutes} min={1} onChange={(durationMinutes) => upd({ durationMinutes })} suffix="min" /></div>}
                    <Button variant="ghost" size="sm" onClick={() => f.update("warnThresholds", d.warnThresholds.filter((_, j) => j !== i))}>
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>
      <Cases />
    </ModuleShell>
  );
}

function Cases() {
  const g = useGuild();
  const { t } = useT();
  const qc = useQueryClient();
  const [user, setUser] = useState("");
  const [action, setAction] = useState("");
  const q = useQuery({
    queryKey: ["cases", g.id, user, action],
    queryFn: () => api<{ rows: Case[] }>(`/guilds/${g.id}/cases?userId=${encodeURIComponent(user)}&action=${action}`),
  });
  const del = useMutation({
    mutationFn: (id: number) => api(`/guilds/${g.id}/cases/${id}`, { method: "DELETE" }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["cases", g.id] }),
  });
  return (
    <Card
      title={t("dash.moderation.cases")}
      padded={false}
      actions={
        <div className="flex gap-2">
          <div className="relative w-48">
            <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
            <input className="input h-8 pl-9" placeholder={t("dash.moderation.userSearch")} value={user} onChange={(e) => setUser(e.target.value)} />
          </div>
          <div className="w-36">
            <Select value={action} onChange={setAction} options={[{ value: "", label: t("dash.moderation.allTypes") }, ...Object.keys(ACTION).map((value) => ({ value, label: actionLabel(t, value) }))]} />
          </div>
        </div>
      }
    >
      {q.isLoading ? (
        <div className="grid h-32 place-items-center"><Spinner /></div>
      ) : !q.data?.rows.length ? (
        <Empty icon={<Gavel className="size-5" />} title={t("dash.moderation.noCases")} />
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs text-muted">
              <th className="px-5 py-2 font-medium">#</th>
              <th className="px-3 py-2 font-medium">{t("dash.moderation.type")}</th>
              <th className="px-3 py-2 font-medium">{t("moderation.user")}</th>
              <th className="px-3 py-2 font-medium">{t("moderation.reason")}</th>
              <th className="px-3 py-2 font-medium">{t("moderation.moderator")}</th>
              <th className="px-3 py-2 font-medium">{t("dash.moderation.date")}</th>
              <th />
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {q.data.rows.map((c) => (
              <tr key={c.id} className="group">
                <td className="px-5 py-2.5 text-muted tabular-nums">{c.caseNumber}</td>
                <td className="px-3 py-2.5"><Badge tone={ACTION[c.action] ?? "neutral"}>{actionLabel(t, c.action)}</Badge></td>
                <td className="px-3 py-2.5">{c.userTag || c.userId}</td>
                <td className="max-w-xs truncate px-3 py-2.5 text-muted" title={c.reason}>{c.reason || "—"}</td>
                <td className="px-3 py-2.5 text-muted">{c.moderatorTag}</td>
                <td className="px-3 py-2.5 whitespace-nowrap text-muted">{fmtDateTime(c.createdAt)}</td>
                <td className="px-3 py-2.5 text-right">
                  <Button variant="ghost" size="sm" className="opacity-0 group-hover:opacity-100" title={t("dash.moderation.deleteCase")} onClick={() => del.mutate(c.id)}>
                    <Trash2 className="size-4" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}
