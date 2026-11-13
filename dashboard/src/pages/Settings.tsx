import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Settings as Cog, CheckCircle2, XCircle } from "lucide-react";
import clsx from "clsx";
import { api, fmtDateTime } from "../lib/api";
import { useGuild, useModuleForm } from "../lib/guild";
import { ModuleShell } from "../components/ModuleShell";
import { Card, ChannelMultiSelect, Empty, Field, NumberInput, Segmented, Select, Spinner, Toggle, useToast } from "../components/ui";
import { useT, languageNames, type TKey } from "../lib/i18n";
import type { GuildData, ModuleState } from "../lib/types";

interface ActionRow {
  id: number;
  source: string;
  action: string;
  targetId: string | null;
  ok: boolean;
  error: string | null;
  data: Record<string, string>;
  createdAt: string;
}

export function Settings() {
  const { t } = useT();
  const f = useModuleForm("activity");
  const g = useGuild();
  const d = f.draft;
  const audit = useQuery({
    queryKey: ["audit", g.id],
    queryFn: () => api<{ id: number; userId: string; action: string; data: Record<string, unknown>; createdAt: string }[]>(`/guilds/${g.id}/audit`),
  });
  return (
    <ModuleShell title={t("dash.nav.settings")} icon={<Cog className="size-5" />} description={t("dash.settings.description")} form={f}>
      <BotLanguage />
      <Card title={t("dash.settings.tracking")}>
        <div className="space-y-4">
          <div className="flex items-center justify-between rounded-lg border border-line px-4 py-3">
            <span className="text-sm">{t("dash.settings.trackMessages")}</span>
            <Toggle checked={d.trackMessages} onChange={(v) => f.update("trackMessages", v)} />
          </div>
          <div className="flex items-center justify-between rounded-lg border border-line px-4 py-3">
            <span className="text-sm">{t("dash.settings.trackVoice")}</span>
            <Toggle checked={d.trackVoice} onChange={(v) => f.update("trackVoice", v)} />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Field label={t("dash.settings.ignoredChannels")}>
              <ChannelMultiSelect value={d.ignoredChannelIds} onChange={(v) => f.update("ignoredChannelIds", v)} types={["text", "voice"]} />
            </Field>
            <Field label={t("dash.settings.inactiveAfter")} hint={t("dash.settings.inactiveAfterHint")}>
              <NumberInput value={d.inactiveDays} min={1} max={365} suffix={t("dash.units.days")} onChange={(v) => f.update("inactiveDays", v)} />
            </Field>
          </div>
        </div>
      </Card>
      <BotActions />
      <Card title={t("dash.settings.auditLog")} description={t("dash.settings.auditLogHint")} padded={false}>
        {audit.isLoading ? (
          <div className="grid h-24 place-items-center"><Spinner /></div>
        ) : !audit.data?.length ? (
          <Empty title={t("dash.settings.noChanges")} />
        ) : (
          <ul className="divide-y divide-line text-sm">
            {audit.data.map((a) => (
              <li key={a.id} className="flex justify-between gap-4 px-5 py-2">
                <span>
                  <span className="font-mono text-xs text-accent-2">{a.action}</span> <span className="text-muted">{t("dash.settings.by", { user: a.userId })}</span>
                </span>
                <span className="text-muted">{fmtDateTime(a.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </ModuleShell>
  );
}

/** The bot's language in Discord for this server. Saved immediately. */
function BotLanguage() {
  const { t } = useT();
  const g = useGuild();
  const qc = useQueryClient();
  const toast = useToast();
  const value = g.modules.general.config.language;
  const save = useMutation({
    mutationFn: (language: string) => api<ModuleState<"general">>(`/guilds/${g.id}/modules/general`, { method: "PUT", json: { enabled: true, config: { language } } }),
    onSuccess: (state) => {
      qc.setQueryData<GuildData>(["guild", g.id], (old) => (old ? { ...old, modules: { ...old.modules, general: state } } : old));
      toast(t("dash.common.saved"));
    },
    onError: (e: Error) => toast(e.message, "bad"),
  });
  return (
    <Card title={t("dash.settings.botLanguage")} description={t("dash.settings.botLanguageHint")}>
      <div className="w-72">
        <Select
          value={value}
          onChange={(v) => save.mutate(v)}
          options={[
            { value: "auto", label: t("dash.settings.languageAuto") },
            { value: "en", label: languageNames.en },
            { value: "sv", label: languageNames.sv },
          ]}
        />
      </div>
    </Card>
  );
}

/** What the bot tried to do and why it failed — e.g. a role above the bot's own role */
function BotActions() {
  const { t } = useT();
  const g = useGuild();
  const [filter, setFilter] = useState<"failed" | "all">("failed");
  const q = useQuery({
    queryKey: ["actionLog", g.id, filter],
    queryFn: () => api<ActionRow[]>(`/guilds/${g.id}/action-log${filter === "failed" ? "?failed=1" : ""}`),
  });
  const role = (id?: string) => (id ? g.roles.find((r) => r.id === id)?.name ?? id : "");
  const detail = (r: ActionRow) => {
    if (r.data.roleId) return role(r.data.roleId);
    if (Array.isArray(r.data.roleIds)) return (r.data.roleIds as unknown as string[]).map(role).join(", ");
    return "";
  };
  return (
    <Card
      title={t("dash.settings.botActions")}
      description={t("dash.settings.botActionsHint")}
      padded={false}
      actions={<Segmented value={filter} onChange={setFilter} options={[{ value: "failed", label: t("dash.settings.failedOnly") }, { value: "all", label: t("dash.members.status.all") }]} />}
    >
      {q.isLoading ? (
        <div className="grid h-24 place-items-center"><Spinner /></div>
      ) : !q.data?.length ? (
        <Empty title={filter === "failed" ? t("dash.settings.noFailures") : t("dash.settings.noActions")} />
      ) : (
        <ul className="divide-y divide-line text-sm">
          {q.data.map((r) => (
            <li key={r.id} className="flex items-start gap-3 px-5 py-2.5">
              {r.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-ok" /> : <XCircle className="mt-0.5 size-4 shrink-0 text-bad" />}
              <div className="min-w-0 flex-1">
                <div>
                  <span className="font-mono text-xs text-accent-2">{r.source}</span> <span>{t(`dash.settings.actions.${r.action.replace(".", "_")}` as TKey)}</span>
                  {detail(r) && <span className="text-muted"> · {detail(r)}</span>}
                  {r.targetId && <span className="text-muted"> · &lt;@{r.targetId}&gt;</span>}
                </div>
                {!r.ok && r.error && <div className={clsx("text-xs text-red-300")}>{t(r.error as TKey, r.data)}</div>}
              </div>
              <span className="shrink-0 text-xs text-muted">{fmtDateTime(r.createdAt)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
