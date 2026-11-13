import { FileClock } from "lucide-react";
import { useModuleForm } from "../lib/guild";
import { ModuleShell } from "../components/ModuleShell";
import { Card, ChannelMultiSelect, ChannelSelect, Field, Toggle } from "../components/ui";
import { serverLogCategories } from "../lib/types";
import { useT } from "../lib/i18n";

export function ServerLog() {
  const { t } = useT();
  const f = useModuleForm("serverLog");
  const d = f.draft;
  return (
    <ModuleShell title={t("dash.nav.serverLog")} icon={<FileClock className="size-5" />} description={t("dash.serverLog.description")} form={f}>
      <Card title={t("dash.serverLog.channels")} description={t("dash.serverLog.channelsHint")}>
        <div className="grid gap-x-6 gap-y-4 lg:grid-cols-2">
          {serverLogCategories.map((cat) => (
            <Field key={cat} label={t(`dash.serverLog.categories.${cat}`)} hint={t(`dash.serverLog.categoryHints.${cat}`)}>
              <ChannelSelect
                value={d.channels[cat]}
                onChange={(v) => f.update("channels", { ...d.channels, [cat]: v })}
                placeholder={t("dash.serverLog.notLogged")}
              />
            </Field>
          ))}
        </div>
      </Card>
      <Card title={t("dash.serverLog.filters")}>
        <div className="space-y-4">
          <div className="flex items-center justify-between rounded-lg border border-line px-4 py-3">
            <div>
              <div className="text-sm font-medium">{t("dash.serverLog.ignoreBots")}</div>
              <div className="text-[13px] text-muted">{t("dash.serverLog.ignoreBotsHint")}</div>
            </div>
            <Toggle checked={d.ignoreBots} onChange={(v) => f.update("ignoreBots", v)} />
          </div>
          <Field label={t("dash.serverLog.ignoredChannels")} hint={t("dash.serverLog.ignoredChannelsHint")}>
            <ChannelMultiSelect value={d.ignoredChannelIds} onChange={(v) => f.update("ignoredChannelIds", v)} types={["text", "voice"]} />
          </Field>
        </div>
      </Card>
    </ModuleShell>
  );
}
