import { Mic } from "lucide-react";
import { useModuleForm } from "../lib/guild";
import { ModuleShell } from "../components/ModuleShell";
import { Card, ChannelMultiSelect, ChannelSelect, Field, NumberInput, TemplateInput } from "../components/ui";
import { useT } from "../lib/i18n";

export function TempVoice() {
  const { t } = useT();
  const f = useModuleForm("tempVoice");
  const d = f.draft;
  return (
    <ModuleShell
      title={t("dash.nav.tempVoice")}
      icon={<Mic className="size-5" />}
      description={
        <>
          {t("dash.tempVoice.description")} <span className="kbd">/voice name</span> <span className="kbd">/voice limit</span>{" "}
          <span className="kbd">/voice lock</span> <span className="kbd">/voice claim</span>
        </>
      }
      form={f}
    >
      <Card title={t("dash.nav.settings")}>
        <div className="grid gap-5 lg:grid-cols-2">
          <Field label={t("dash.tempVoice.hubs")} hint={t("dash.tempVoice.hubsHint")}>
            <ChannelMultiSelect value={d.hubChannelIds} onChange={(v) => f.update("hubChannelIds", v)} types={["voice"]} placeholder={t("dash.pickers.voiceChannels")} />
          </Field>
          <Field label={t("dash.tempVoice.category")} hint={t("dash.tempVoice.categoryHint")}>
            <ChannelSelect value={d.categoryId} onChange={(v) => f.update("categoryId", v)} types={["category"]} placeholder={t("dash.tempVoice.sameAsHub")} />
          </Field>
          <Field label={t("dash.tempVoice.name")}>
            <TemplateInput
              rows={1}
              value={d.nameTemplate}
              placeholder={t("defaults.tempVoiceName")}
              onChange={(v) => f.update("nameTemplate", v)}
              variables={[
                { key: "displayname", label: t("dash.vars.displayname") },
                { key: "username", label: t("dash.vars.username") },
              ]}
            />
          </Field>
          <Field label={t("dash.tempVoice.limit")} hint={t("dash.tempVoice.limitHint")}>
            <NumberInput value={d.userLimit} min={0} max={99} onChange={(v) => f.update("userLimit", v)} />
          </Field>
        </div>
      </Card>
    </ModuleShell>
  );
}
