import { useMutation } from "@tanstack/react-query";
import { DoorOpen, Send } from "lucide-react";
import { api } from "../lib/api";
import { useGuild, useModuleForm } from "../lib/guild";
import { ModuleShell } from "../components/ModuleShell";
import { Button, Card, ChannelSelect, Field, RoleMultiSelect, ToggleRow, useToast } from "../components/ui";
import { MessageDesigner, type Design } from "../components/MessageDesigner";
import { useT } from "../lib/i18n";

/** Posts the design once to a channel so it can be checked in Discord (as if you had just joined) */
function TestButton({ channelId, design, fallback }: { channelId: string | null; design: Design; fallback: string }) {
  const g = useGuild();
  const { t } = useT();
  const toast = useToast();
  const send = useMutation({
    mutationFn: () => api(`/guilds/${g.id}/embeds/test`, { method: "POST", json: { channelId, design, fallback } }),
    onSuccess: () => toast(t("dash.design.testSent")),
    onError: (e: Error) => toast(e.message, "bad"),
  });
  return (
    <Button size="sm" icon={<Send className="size-4" />} disabled={!channelId} loading={send.isPending} onClick={() => send.mutate()} title={t("dash.design.testHint")}>
      {t("dash.design.sendTest")}
    </Button>
  );
}

export function Welcome() {
  const { t } = useT();
  const f = useModuleForm("welcome");
  const d = f.draft;
  const vars = [
    { key: "user", label: t("dash.vars.user") },
    { key: "username", label: t("dash.vars.username") },
    { key: "displayname", label: t("dash.vars.displayname") },
    { key: "server", label: t("dash.vars.server") },
    { key: "membercount", label: t("dash.vars.membercount") },
  ];
  return (
    <ModuleShell title={t("dash.nav.welcome")} icon={<DoorOpen className="size-5" />} description={t("dash.welcome.description")} form={f}>
      <Card title={t("dash.welcome.messages")} description={t("dash.welcome.defaultHint")}>
        <div className="space-y-3">
          <ToggleRow title={t("dash.welcome.join")} checked={d.join.enabled} onChange={(enabled) => f.update("join", { ...d.join, enabled })}>
            <div className="flex flex-wrap items-end gap-3">
              <Field label={t("dash.common.channel")} className="min-w-64 flex-1">
                <ChannelSelect value={d.join.channelId} onChange={(channelId) => f.update("join", { ...d.join, channelId })} />
              </Field>
              <TestButton channelId={d.join.channelId} design={d.join} fallback={t("defaults.welcomeJoin")} />
            </div>
            <MessageDesigner value={d.join} onChange={(v) => f.update("join", { ...d.join, ...v })} vars={vars} placeholder={t("defaults.welcomeJoin")} />
          </ToggleRow>
          <ToggleRow title={t("dash.welcome.dm")} description={t("dash.welcome.dmHint")} checked={d.dm.enabled} onChange={(enabled) => f.update("dm", { ...d.dm, enabled })}>
            <MessageDesigner value={d.dm} onChange={(v) => f.update("dm", { ...d.dm, ...v })} vars={vars} placeholder={t("defaults.welcomeDm")} />
          </ToggleRow>
          <ToggleRow title={t("dash.welcome.leave")} checked={d.leave.enabled} onChange={(enabled) => f.update("leave", { ...d.leave, enabled })}>
            <div className="flex flex-wrap items-end gap-3">
              <Field label={t("dash.common.channel")} className="min-w-64 flex-1">
                <ChannelSelect value={d.leave.channelId} onChange={(channelId) => f.update("leave", { ...d.leave, channelId })} />
              </Field>
              <TestButton channelId={d.leave.channelId} design={d.leave} fallback={t("defaults.welcomeLeave")} />
            </div>
            <MessageDesigner value={d.leave} onChange={(v) => f.update("leave", { ...d.leave, ...v })} vars={vars} placeholder={t("defaults.welcomeLeave")} />
          </ToggleRow>
        </div>
      </Card>
      <Card title={t("dash.welcome.autoroles")} description={t("dash.welcome.autorolesHint")}>
        <RoleMultiSelect value={d.autoRoleIds} onChange={(v) => f.update("autoRoleIds", v)} assignableOnly />
      </Card>
    </ModuleShell>
  );
}
