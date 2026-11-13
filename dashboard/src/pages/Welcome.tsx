import { DoorOpen } from "lucide-react";
import { useModuleForm } from "../lib/guild";
import { ModuleShell } from "../components/ModuleShell";
import { Card, ChannelSelect, Field, RoleMultiSelect, TemplateInput, ToggleRow } from "../components/ui";

const VARS = [
  { key: "user", label: "Nämner användaren" },
  { key: "username", label: "Användarnamn" },
  { key: "displayname", label: "Visningsnamn" },
  { key: "server", label: "Servernamn" },
  { key: "membercount", label: "Antal medlemmar" },
];

export function Welcome() {
  const f = useModuleForm("welcome");
  const d = f.draft;
  return (
    <ModuleShell title="Välkomst" icon={<DoorOpen className="size-5" />} description="Hälsa nya medlemmar välkomna, ge dem roller direkt och säg hejdå när någon lämnar." form={f}>
      <Card title="Meddelanden">
        <div className="space-y-3">
          <ToggleRow title="Välkomstmeddelande i kanal" checked={d.join.enabled} onChange={(enabled) => f.update("join", { ...d.join, enabled })}>
            <Field label="Kanal">
              <ChannelSelect value={d.join.channelId} onChange={(channelId) => f.update("join", { ...d.join, channelId })} />
            </Field>
            <Field label="Meddelande">
              <TemplateInput value={d.join.message} onChange={(message) => f.update("join", { ...d.join, message })} variables={VARS} />
            </Field>
          </ToggleRow>
          <ToggleRow title="Privat meddelande (DM)" description="Skickas direkt till den nya medlemmen." checked={d.dm.enabled} onChange={(enabled) => f.update("dm", { ...d.dm, enabled })}>
            <TemplateInput value={d.dm.message} onChange={(message) => f.update("dm", { ...d.dm, message })} variables={VARS} rows={4} />
          </ToggleRow>
          <ToggleRow title="Meddelande när någon lämnar" checked={d.leave.enabled} onChange={(enabled) => f.update("leave", { ...d.leave, enabled })}>
            <Field label="Kanal">
              <ChannelSelect value={d.leave.channelId} onChange={(channelId) => f.update("leave", { ...d.leave, channelId })} />
            </Field>
            <Field label="Meddelande">
              <TemplateInput value={d.leave.message} onChange={(message) => f.update("leave", { ...d.leave, message })} variables={VARS} />
            </Field>
          </ToggleRow>
        </div>
      </Card>
      <Card title="Autoroller" description="Ges till alla nya medlemmar. Har servern regelgodkännande (membership screening) ges rollerna när medlemmen har godkänt reglerna.">
        <RoleMultiSelect value={d.autoRoleIds} onChange={(v) => f.update("autoRoleIds", v)} assignableOnly />
      </Card>
    </ModuleShell>
  );
}
