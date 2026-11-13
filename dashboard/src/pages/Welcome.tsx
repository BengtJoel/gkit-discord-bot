import { DoorOpen } from "lucide-react";
import { useModuleForm } from "../lib/guild";
import { ModuleShell } from "../components/ModuleShell";
import { Card, ChannelSelect, Field, RoleMultiSelect, TemplateInput, ToggleRow } from "../components/ui";
import { useT } from "../lib/i18n";

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
      <Card title={t("dash.welcome.messages")}>
        <div className="space-y-3">
          <ToggleRow title={t("dash.welcome.join")} checked={d.join.enabled} onChange={(enabled) => f.update("join", { ...d.join, enabled })}>
            <Field label={t("dash.common.channel")}>
              <ChannelSelect value={d.join.channelId} onChange={(channelId) => f.update("join", { ...d.join, channelId })} />
            </Field>
            <Field label={t("dash.common.message")}>
              <TemplateInput value={d.join.message} placeholder={t("defaults.welcomeJoin")} onChange={(message) => f.update("join", { ...d.join, message })} variables={vars} />
            </Field>
          </ToggleRow>
          <ToggleRow title={t("dash.welcome.dm")} description={t("dash.welcome.dmHint")} checked={d.dm.enabled} onChange={(enabled) => f.update("dm", { ...d.dm, enabled })}>
            <TemplateInput value={d.dm.message} placeholder={t("defaults.welcomeDm")} onChange={(message) => f.update("dm", { ...d.dm, message })} variables={vars} rows={4} />
          </ToggleRow>
          <ToggleRow title={t("dash.welcome.leave")} checked={d.leave.enabled} onChange={(enabled) => f.update("leave", { ...d.leave, enabled })}>
            <Field label={t("dash.common.channel")}>
              <ChannelSelect value={d.leave.channelId} onChange={(channelId) => f.update("leave", { ...d.leave, channelId })} />
            </Field>
            <Field label={t("dash.common.message")}>
              <TemplateInput value={d.leave.message} placeholder={t("defaults.welcomeLeave")} onChange={(message) => f.update("leave", { ...d.leave, message })} variables={vars} />
            </Field>
          </ToggleRow>
        </div>
        <p className="hint mt-3">{t("dash.welcome.defaultHint")}</p>
      </Card>
      <Card title={t("dash.welcome.autoroles")} description={t("dash.welcome.autorolesHint")}>
        <RoleMultiSelect value={d.autoRoleIds} onChange={(v) => f.update("autoRoleIds", v)} assignableOnly />
      </Card>
    </ModuleShell>
  );
}
