import { ShieldCheck } from "lucide-react";
import { useModuleForm } from "../lib/guild";
import type { AutomodAction, ModuleConfigs } from "../lib/types";
import { ModuleShell } from "../components/ModuleShell";
import { Card, ChannelMultiSelect, Field, NumberInput, RoleMultiSelect, Select, TagInput, ToggleRow } from "../components/ui";
import { useT } from "../lib/i18n";

type Cfg = ModuleConfigs["automod"];
type RuleKey = "badWords" | "invites" | "links" | "mentions" | "caps" | "spam";

export function Automod() {
  const { t } = useT();
  const f = useModuleForm("automod");
  const d = f.draft;
  const rule = <K extends RuleKey>(k: K, patch: Partial<Cfg[K]>) => f.update(k, { ...d[k], ...patch });
  const actions: { value: AutomodAction; label: string }[] = [
    { value: "delete", label: t("dash.automod.actions.delete") },
    { value: "delete_warn", label: t("dash.automod.actions.deleteWarn") },
    { value: "delete_timeout", label: t("dash.automod.actions.deleteTimeout") },
  ];
  const actionPick = (k: RuleKey) => (
    <Field label={t("dash.automod.action")}>
      <Select value={d[k].action} onChange={(action) => rule(k, { action })} options={actions} />
    </Field>
  );

  return (
    <ModuleShell title={t("dash.nav.automod")} icon={<ShieldCheck className="size-5" />} description={t("dash.automod.description")} form={f}>
      <Card title={t("dash.automod.rules")}>
        <div className="space-y-3">
          <ToggleRow title={t("dash.automod.badWords")} description={t("dash.automod.badWordsHint")} checked={d.badWords.enabled} onChange={(enabled) => rule("badWords", { enabled })}>
            <Field label={t("dash.automod.words")} hint={t("dash.automod.wordsHint")}>
              <TagInput value={d.badWords.words} onChange={(words) => rule("badWords", { words })} placeholder={t("dash.automod.addWord")} />
            </Field>
            {actionPick("badWords")}
          </ToggleRow>
          <ToggleRow title={t("dash.automod.invites")} description={t("dash.automod.invitesHint")} checked={d.invites.enabled} onChange={(enabled) => rule("invites", { enabled })}>
            {actionPick("invites")}
          </ToggleRow>
          <ToggleRow title={t("dash.automod.links")} description={t("dash.automod.linksHint")} checked={d.links.enabled} onChange={(enabled) => rule("links", { enabled })}>
            <Field label={t("dash.automod.allowedDomains")} hint={t("dash.automod.allowedDomainsHint")}>
              <TagInput value={d.links.allowedDomains} onChange={(allowedDomains) => rule("links", { allowedDomains })} placeholder="warcraftlogs.com, raidbots.com" />
            </Field>
            {actionPick("links")}
          </ToggleRow>
          <ToggleRow title={t("dash.automod.mentions")} description={t("dash.automod.mentionsHint")} checked={d.mentions.enabled} onChange={(enabled) => rule("mentions", { enabled })}>
            <Field label={t("dash.automod.maxMentions")}>
              <NumberInput value={d.mentions.max} min={1} max={50} onChange={(max) => rule("mentions", { max })} />
            </Field>
            {actionPick("mentions")}
          </ToggleRow>
          <ToggleRow title={t("dash.automod.caps")} description={t("dash.automod.capsHint")} checked={d.caps.enabled} onChange={(enabled) => rule("caps", { enabled })}>
            <div className="grid grid-cols-2 gap-4">
              <Field label={t("dash.automod.minLetters")}>
                <NumberInput value={d.caps.minLength} min={1} onChange={(minLength) => rule("caps", { minLength })} />
              </Field>
              <Field label={t("dash.automod.capsShare")}>
                <NumberInput value={d.caps.percent} min={1} max={100} suffix="%" onChange={(percent) => rule("caps", { percent })} />
              </Field>
            </div>
            {actionPick("caps")}
          </ToggleRow>
          <ToggleRow title={t("dash.automod.spam")} description={t("dash.automod.spamHint")} checked={d.spam.enabled} onChange={(enabled) => rule("spam", { enabled })}>
            <div className="grid grid-cols-2 gap-4">
              <Field label={t("dash.automod.maxMessages")}>
                <NumberInput value={d.spam.messages} min={2} max={50} onChange={(messages) => rule("spam", { messages })} />
              </Field>
              <Field label={t("dash.automod.within")}>
                <NumberInput value={d.spam.seconds} min={1} max={120} suffix={t("dash.units.sec")} onChange={(seconds) => rule("spam", { seconds })} />
              </Field>
            </div>
            {actionPick("spam")}
          </ToggleRow>
        </div>
      </Card>
      <Card title={t("dash.automod.common")}>
        <div className="grid gap-4 lg:grid-cols-3">
          <Field label={t("dash.automod.timeoutLength")} hint={t("dash.automod.timeoutLengthHint")}>
            <NumberInput value={d.timeoutMinutes} min={1} suffix="min" onChange={(v) => f.update("timeoutMinutes", v)} />
          </Field>
          <Field label={t("dash.automod.exemptRoles")}>
            <RoleMultiSelect value={d.exemptRoleIds} onChange={(v) => f.update("exemptRoleIds", v)} />
          </Field>
          <Field label={t("dash.automod.exemptChannels")}>
            <ChannelMultiSelect value={d.exemptChannelIds} onChange={(v) => f.update("exemptChannelIds", v)} />
          </Field>
        </div>
      </Card>
    </ModuleShell>
  );
}
