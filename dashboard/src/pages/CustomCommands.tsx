import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, TerminalSquare, Trash2 } from "lucide-react";
import { api, fmtNum } from "../lib/api";
import { useGuild, useModuleForm } from "../lib/guild";
import { ModuleShell } from "../components/ModuleShell";
import { Badge, Button, Card, ChannelMultiSelect, Empty, Field, Modal, NumberInput, RoleMultiSelect, Segmented, Spinner, TemplateInput, Toggle, useToast } from "../components/ui";
import { useT } from "../lib/i18n";

interface Cmd {
  id?: number;
  name: string;
  description: string;
  response: string;
  responseMode: "channel" | "ephemeral" | "dm";
  allowedChannelIds: string[];
  cooldownSeconds: number;
  addRoleIds: string[];
  removeRoleIds: string[];
  allowedRoleIds: string[];
  enabled: boolean;
  uses?: number;
}
const blank: Cmd = { name: "", description: "", response: "", responseMode: "channel", allowedChannelIds: [], cooldownSeconds: 0, addRoleIds: [], removeRoleIds: [], allowedRoleIds: [], enabled: true };

export function CustomCommands() {
  const f = useModuleForm("customCommands");
  const g = useGuild();
  const { t } = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const [draft, setDraft] = useState<Cmd | null>(null);
  const list = useQuery({ queryKey: ["cmds", g.id], queryFn: () => api<Cmd[]>(`/guilds/${g.id}/commands`) });
  const save = useMutation({
    mutationFn: (c: Cmd) => (c.id ? api(`/guilds/${g.id}/commands/${c.id}`, { method: "PUT", json: c }) : api(`/guilds/${g.id}/commands`, { method: "POST", json: c })),
    onSuccess: () => {
      toast(t("dash.commands.saved"));
      setDraft(null);
      void qc.invalidateQueries({ queryKey: ["cmds", g.id] });
    },
    onError: (e: Error) => toast(e.message, "bad"),
  });
  const del = useMutation({
    mutationFn: (id: number) => api(`/guilds/${g.id}/commands/${id}`, { method: "DELETE" }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["cmds", g.id] }),
  });

  return (
    <ModuleShell
      title={t("dash.nav.commands")}
      icon={<TerminalSquare className="size-5" />}
      description={t("dash.commands.description")}
      form={f}
      actions={<Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setDraft({ ...blank })}>{t("dash.commands.new")}</Button>}
    >
      <Card padded={false}>
        {list.isLoading ? (
          <div className="grid h-32 place-items-center"><Spinner /></div>
        ) : !list.data?.length ? (
          <Empty icon={<TerminalSquare className="size-5" />} title={t("dash.commands.emptyTitle")}>{t("dash.commands.emptyBody")}</Empty>
        ) : (
          <ul className="divide-y divide-line">
            {list.data.map((c) => (
              <li key={c.id} className="group flex items-center gap-4 px-5 py-3">
                <span className="font-mono text-sm font-medium text-accent-2">/{c.name}</span>
                <span className="flex-1 truncate text-sm text-muted">{c.response}</span>
                {!c.enabled && <Badge>{t("dash.module.off")}</Badge>}
                {c.responseMode !== "channel" && <Badge>{t(`dash.commands.modes.${c.responseMode}`)}</Badge>}
                {c.cooldownSeconds > 0 && <Badge>{c.cooldownSeconds} {t("dash.units.sec")}</Badge>}
                <span className="text-xs text-muted tabular-nums">{t("dash.commands.uses", { count: c.uses ?? 0, n: fmtNum(c.uses) })}</span>
                <Button variant="ghost" size="sm" onClick={() => setDraft(c)}><Pencil className="size-4" /></Button>
                <Button variant="ghost" size="sm" onClick={() => confirm(t("dash.commands.confirmDelete", { name: c.name })) && del.mutate(c.id!)}><Trash2 className="size-4" /></Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {draft && (
        <Modal
          open
          wide
          onClose={() => setDraft(null)}
          title={draft.id ? t("dash.commands.editTitle", { name: draft.name }) : t("dash.commands.new")}
          footer={
            <>
              <Button variant="ghost" onClick={() => setDraft(null)}>{t("dash.common.cancel")}</Button>
              <Button variant="primary" loading={save.isPending} disabled={!draft.name || !draft.response} onClick={() => save.mutate(draft)}>{t("dash.common.save")}</Button>
            </>
          }
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("dash.common.name")} hint={t("dash.commands.nameHint")}>
              <div className="flex items-center">
                <span className="grid h-9 place-items-center rounded-l-md border border-r-0 border-line bg-panel px-2.5 font-mono text-muted">/</span>
                <input className="input rounded-l-none font-mono" value={draft.name} maxLength={32} onChange={(e) => setDraft({ ...draft, name: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, "") })} />
              </div>
            </Field>
            <Field label={t("dash.common.description")} hint={t("dash.commands.descriptionHint")}>
              <input className="input" value={draft.description} maxLength={100} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
            </Field>
          </div>
          <Field label={t("dash.commands.response")}>
            <TemplateInput
              rows={4}
              value={draft.response}
              onChange={(response) => setDraft({ ...draft, response })}
              variables={[
                { key: "user", label: t("dash.vars.invoker") },
                { key: "target", label: t("dash.vars.target") },
                { key: "username", label: t("dash.vars.username") },
                { key: "server", label: t("dash.vars.server") },
                { key: "channel", label: t("dash.vars.channel") },
                { key: "membercount", label: t("dash.vars.membercount") },
              ]}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("dash.commands.addRoles")}><RoleMultiSelect value={draft.addRoleIds} onChange={(addRoleIds) => setDraft({ ...draft, addRoleIds })} assignableOnly /></Field>
            <Field label={t("dash.commands.removeRoles")}><RoleMultiSelect value={draft.removeRoleIds} onChange={(removeRoleIds) => setDraft({ ...draft, removeRoleIds })} assignableOnly /></Field>
          </div>
          <Field label={t("dash.commands.allowedRoles")} hint={t("dash.commands.allowedRolesHint")}>
            <RoleMultiSelect value={draft.allowedRoleIds} onChange={(allowedRoleIds) => setDraft({ ...draft, allowedRoleIds })} />
          </Field>
          <Field label={t("dash.commands.allowedChannels")} hint={t("dash.commands.allowedChannelsHint")}>
            <ChannelMultiSelect value={draft.allowedChannelIds} onChange={(allowedChannelIds) => setDraft({ ...draft, allowedChannelIds })} types={["text", "category"]} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
            <Field label={t("dash.commands.responseMode")} hint={t(`dash.commands.modeHints.${draft.responseMode}`)}>
              <Segmented
                value={draft.responseMode}
                onChange={(responseMode) => setDraft({ ...draft, responseMode })}
                options={(["channel", "ephemeral", "dm"] as const).map((v) => ({ value: v, label: t(`dash.commands.modes.${v}`) }))}
              />
            </Field>
            <Field label={t("dash.commands.cooldown")} hint={t("dash.commands.cooldownHint")}>
              <NumberInput value={draft.cooldownSeconds} onChange={(cooldownSeconds) => setDraft({ ...draft, cooldownSeconds })} min={0} max={86400} suffix={t("dash.units.sec")} />
            </Field>
          </div>
          <div className="flex flex-wrap gap-6">
            <label className="flex items-center gap-3 text-sm"><Toggle size="sm" checked={draft.enabled} onChange={(enabled) => setDraft({ ...draft, enabled })} /> {t("dash.common.active")}</label>
          </div>
        </Modal>
      )}
    </ModuleShell>
  );
}
