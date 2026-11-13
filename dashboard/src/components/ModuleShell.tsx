import type { ReactNode } from "react";
import clsx from "clsx";
import { Button, PageHeader, Toggle } from "./ui";
import { useT } from "../lib/i18n";

/** Page wrapper for a module: header with on/off switch, content, and a sticky save bar when there are unsaved changes. */
export function ModuleShell({
  title,
  description,
  icon,
  form,
  actions,
  children,
}: {
  title: string;
  description: ReactNode;
  icon: ReactNode;
  form: { enabled: boolean; setEnabled: (v: boolean) => Promise<unknown>; dirty?: boolean; saving?: boolean; save?: () => Promise<unknown>; reset?: () => void };
  actions?: ReactNode;
  children: ReactNode;
}) {
  const { t } = useT();
  return (
    <div className="pb-24">
      <PageHeader
        title={title}
        description={description}
        icon={icon}
        actions={
          <>
            {actions}
            <div className={clsx("flex items-center gap-3 rounded-lg border px-3 py-2", form.enabled ? "border-accent/40 bg-accent/10" : "border-line bg-panel")}>
              <span className="text-[13px] font-medium">{form.enabled ? t("dash.module.on") : t("dash.module.off")}</span>
              <Toggle checked={form.enabled} onChange={(v) => void form.setEnabled(v)} />
            </div>
          </>
        }
      />
      {!form.enabled && (
        <div className="mb-5 rounded-lg border border-line bg-panel px-4 py-3 text-sm text-muted">
          {t("dash.module.offBanner")}
        </div>
      )}
      <div className="space-y-5">{children}</div>

      {form.dirty && (
        <div className="fixed inset-x-0 bottom-5 z-40 flex justify-center px-4 lg:pl-64">
          <div className="flex w-full max-w-2xl items-center justify-between gap-4 rounded-xl border border-line-2 bg-panel-2/95 px-4 py-3 shadow-2xl shadow-black/60 backdrop-blur">
            <span className="text-sm">{t("dash.module.unsaved")}</span>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={form.reset}>
                {t("dash.common.undo")}
              </Button>
              <Button variant="primary" size="sm" loading={form.saving} onClick={() => void form.save?.()}>
                {t("dash.common.saveChanges")}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
