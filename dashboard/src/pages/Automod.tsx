import { ShieldCheck } from "lucide-react";
import { useModuleForm } from "../lib/guild";
import type { AutomodAction, ModuleConfigs } from "../lib/types";
import { ModuleShell } from "../components/ModuleShell";
import { Card, ChannelMultiSelect, Field, NumberInput, RoleMultiSelect, Select, TagInput, ToggleRow } from "../components/ui";

type Cfg = ModuleConfigs["automod"];
const actions: { value: AutomodAction; label: string }[] = [
  { value: "delete", label: "Radera meddelandet" },
  { value: "delete_warn", label: "Radera + varna" },
  { value: "delete_timeout", label: "Radera + timeout" },
];

export function Automod() {
  const f = useModuleForm("automod");
  const d = f.draft;
  const rule = <K extends "badWords" | "invites" | "links" | "mentions" | "caps" | "spam">(k: K, patch: Partial<Cfg[K]>) => f.update(k, { ...d[k], ...patch });
  const ActionPick = ({ k }: { k: "badWords" | "invites" | "links" | "mentions" | "caps" | "spam" }) => (
    <Field label="Åtgärd">
      <Select value={d[k].action} onChange={(action) => rule(k, { action })} options={actions} />
    </Field>
  );

  return (
    <ModuleShell
      title="Automod"
      icon={<ShieldCheck className="size-5" />}
      description="Filtrerar bort oönskat innehåll automatiskt. Medlemmar med Hantera meddelanden påverkas aldrig. Varningar räknas mot eskaleringen under Moderering."
      form={f}
    >
      <Card title="Regler">
        <div className="space-y-3">
          <ToggleRow title="Förbjudna ord" description="Använd * som jokertecken, t.ex. idiot* matchar idioter." checked={d.badWords.enabled} onChange={(enabled) => rule("badWords", { enabled })}>
            <Field label="Ord" hint="Tryck Enter eller komma efter varje ord.">
              <TagInput value={d.badWords.words} onChange={(words) => rule("badWords", { words })} placeholder="Lägg till ord…" />
            </Field>
            <ActionPick k="badWords" />
          </ToggleRow>
          <ToggleRow title="Discord-inbjudningar" description="Blockerar discord.gg-länkar till andra servrar." checked={d.invites.enabled} onChange={(enabled) => rule("invites", { enabled })}>
            <ActionPick k="invites" />
          </ToggleRow>
          <ToggleRow title="Länkar" description="Blockerar alla länkar utom tillåtna domäner." checked={d.links.enabled} onChange={(enabled) => rule("links", { enabled })}>
            <Field label="Tillåtna domäner" hint="Underdomäner ingår automatiskt.">
              <TagInput value={d.links.allowedDomains} onChange={(allowedDomains) => rule("links", { allowedDomains })} placeholder="t.ex. warcraftlogs.com, raidbots.com" />
            </Field>
            <ActionPick k="links" />
          </ToggleRow>
          <ToggleRow title="Massnämningar" description="För många @-nämningar i ett meddelande." checked={d.mentions.enabled} onChange={(enabled) => rule("mentions", { enabled })}>
            <Field label="Max nämningar per meddelande">
              <NumberInput value={d.mentions.max} min={1} max={50} onChange={(max) => rule("mentions", { max })} />
            </Field>
            <ActionPick k="mentions" />
          </ToggleRow>
          <ToggleRow title="Versaler" description="Meddelanden som mest består av STORA BOKSTÄVER." checked={d.caps.enabled} onChange={(enabled) => rule("caps", { enabled })}>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Minsta antal bokstäver">
                <NumberInput value={d.caps.minLength} min={1} onChange={(minLength) => rule("caps", { minLength })} />
              </Field>
              <Field label="Andel versaler">
                <NumberInput value={d.caps.percent} min={1} max={100} suffix="%" onChange={(percent) => rule("caps", { percent })} />
              </Field>
            </div>
            <ActionPick k="caps" />
          </ToggleRow>
          <ToggleRow title="Spam" description="För många meddelanden på kort tid." checked={d.spam.enabled} onChange={(enabled) => rule("spam", { enabled })}>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Max meddelanden">
                <NumberInput value={d.spam.messages} min={2} max={50} onChange={(messages) => rule("spam", { messages })} />
              </Field>
              <Field label="Inom">
                <NumberInput value={d.spam.seconds} min={1} max={120} suffix="sek" onChange={(seconds) => rule("spam", { seconds })} />
              </Field>
            </div>
            <ActionPick k="spam" />
          </ToggleRow>
        </div>
      </Card>
      <Card title="Gemensamt">
        <div className="grid gap-4 lg:grid-cols-3">
          <Field label="Timeout-längd" hint="För regler med åtgärden timeout.">
            <NumberInput value={d.timeoutMinutes} min={1} suffix="min" onChange={(v) => f.update("timeoutMinutes", v)} />
          </Field>
          <Field label="Undantagna roller">
            <RoleMultiSelect value={d.exemptRoleIds} onChange={(v) => f.update("exemptRoleIds", v)} />
          </Field>
          <Field label="Undantagna kanaler">
            <ChannelMultiSelect value={d.exemptChannelIds} onChange={(v) => f.update("exemptChannelIds", v)} />
          </Field>
        </div>
      </Card>
    </ModuleShell>
  );
}
