import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Download, ExternalLink, XCircle } from "lucide-react";
import { api, fmtNum } from "../lib/api";
import { useGuild } from "../lib/guild";
import { Badge, Button, Card, PageHeader, Segmented, Spinner, Toggle, useToast } from "../components/ui";
import { useT } from "../lib/i18n";

interface Preview {
  samplePlayers: { id: string; username?: string; xp: number; level: number }[];
  playersOnFirstPage: number;
  roleRewards: { level: number; roleId?: string; roleName?: string }[];
  xpPerMessage: [number, number] | null;
  xpRate: number | null;
}
interface Job {
  status: "running" | "done" | "error";
  pages: number;
  players: number;
  rewards: number;
  error?: string;
  errorParams?: Record<string, string | number>;
  finishedAt?: string;
}

export function Mee6Import() {
  const g = useGuild();
  const { t } = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const [mode, setMode] = useState<"max" | "replace" | "add">("max");
  const [importRewards, setImportRewards] = useState(true);
  const [importXpSettings, setImportXpSettings] = useState(true);

  const preview = useMutation({ mutationFn: () => api<Preview>(`/guilds/${g.id}/import/mee6/preview`) });
  const job = useQuery({
    queryKey: ["mee6job", g.id],
    queryFn: () => api<Job | null>(`/guilds/${g.id}/import/mee6`),
    refetchInterval: (q) => (q.state.data?.status === "running" ? 1000 : false),
  });
  const start = useMutation({
    mutationFn: () => api<Job>(`/guilds/${g.id}/import/mee6`, { method: "POST", json: { mode, importRewards, importXpSettings } }),
    onSuccess: (j) => {
      qc.setQueryData(["mee6job", g.id], j);
      void qc.invalidateQueries({ queryKey: ["mee6job", g.id] });
    },
    onError: (e: Error) => toast(e.message, "bad"),
  });
  const running = job.data?.status === "running";
  const roleName = (id?: string) => g.roles.find((r) => r.id === id)?.name;

  // Refresh levels + settings once a job finishes
  const status = job.data?.status;
  useEffect(() => {
    if (status === "done") {
      void qc.invalidateQueries({ queryKey: ["guild", g.id] });
      void qc.invalidateQueries({ queryKey: ["levels", g.id] });
    }
  }, [status, g.id, qc]);

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("dash.nav.import")}
        icon={<Download className="size-5" />}
        description={t("dash.import.description")}
      />

      <Card title={t("dash.import.step1")}>
        <ol className="list-decimal space-y-1.5 pl-5 text-sm text-muted">
          <li>{t("dash.import.step1a")}</li>
          <li>{t("dash.import.step1b")}</li>
          <li>{t("dash.import.step1c")}</li>
        </ol>
        <div className="mt-4 flex flex-wrap gap-2">
          <a href={`https://mee6.xyz/dashboard/${g.id}/leaderboard`} target="_blank" rel="noreferrer">
            <Button icon={<ExternalLink className="size-4" />}>{t("dash.import.openMee6")}</Button>
          </a>
          <Button variant="primary" loading={preview.isPending} onClick={() => preview.mutate()}>
            {t("dash.import.test")}
          </Button>
        </div>
        {preview.error && (
          <div className="mt-4 flex gap-2 rounded-lg border border-bad/30 bg-bad/10 px-4 py-3 text-sm text-red-200">
            <XCircle className="size-5 shrink-0" /> {preview.error.message}
          </div>
        )}
        {preview.data && (
          <div className="mt-4 space-y-3 rounded-lg border border-ok/30 bg-ok/5 p-4 text-sm">
            <div className="flex items-center gap-2 font-medium text-green-300">
              <CheckCircle2 className="size-5" /> {t("dash.import.connectionOk")}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <div className="mb-1 text-xs text-muted uppercase">{t("dash.import.top10")}</div>
                <ol className="space-y-0.5">
                  {preview.data.samplePlayers.map((p, i) => (
                    <li key={p.id} className="flex justify-between gap-2">
                      <span>{i + 1}. {p.username ?? p.id}</span>
                      <span className="text-muted tabular-nums">lvl {p.level} · {fmtNum(p.xp)} XP</span>
                    </li>
                  ))}
                </ol>
              </div>
              <div className="space-y-3">
                <div>
                  <div className="mb-1 text-xs text-muted uppercase">{t("dash.levels.rewards")}</div>
                  {preview.data.roleRewards.length === 0 ? (
                    <span className="text-muted">{t("dash.common.none")}</span>
                  ) : (
                    preview.data.roleRewards.map((r) => (
                      <div key={`${r.level}-${r.roleId}`} className="flex items-center gap-2">
                        {t("dash.members.level")} {r.level} → {r.roleName ?? roleName(r.roleId) ?? r.roleId}
                        {r.roleId && !g.roles.some((x) => x.id === r.roleId) && <Badge tone="warn">{t("dash.import.roleGone")}</Badge>}
                      </div>
                    ))
                  )}
                </div>
                <div>
                  <div className="mb-1 text-xs text-muted uppercase">{t("dash.import.xpSettings")}</div>
                  {preview.data.xpPerMessage ? t("dash.import.xpPerMessage", { min: preview.data.xpPerMessage[0], max: preview.data.xpPerMessage[1] }) : "—"}
                  {preview.data.xpRate ? ` · ${t("dash.import.xpRate", { rate: preview.data.xpRate })}` : ""}
                </div>
              </div>
            </div>
          </div>
        )}
      </Card>

      <Card title={t("dash.import.step2")}>
        <div className="space-y-4">
          <Segmented
            value={mode}
            onChange={setMode}
            options={[
              { value: "max", label: t("dash.import.modes.max") },
              { value: "replace", label: t("dash.import.modes.replace") },
              { value: "add", label: t("dash.import.modes.add") },
            ]}
          />
          <p className="text-sm text-muted">
            {t(`dash.import.modeHints.${mode}`)}
          </p>
          <div className="flex items-center justify-between rounded-lg border border-line px-4 py-3">
            <span className="text-sm">{t("dash.import.importRewards")}</span>
            <Toggle checked={importRewards} onChange={setImportRewards} />
          </div>
          <div className="flex items-center justify-between rounded-lg border border-line px-4 py-3">
            <span className="text-sm">{t("dash.import.importXpSettings")}</span>
            <Toggle checked={importXpSettings} onChange={setImportXpSettings} />
          </div>
        </div>
      </Card>

      <Card title={t("dash.import.step3")}>
        <Button variant="primary" icon={<Download className="size-4" />} loading={running || start.isPending} onClick={() => start.mutate()}>
          {running ? t("dash.import.running") : t("dash.import.start")}
        </Button>
        {job.data && (
          <div className="mt-4 rounded-lg border border-line bg-panel-2/40 p-4 text-sm">
            {job.data.status === "running" && (
              <div className="flex items-center gap-2">
                <Spinner className="size-4" /> {t("dash.import.progress", { page: job.data.pages + 1, n: fmtNum(job.data.players) })}
              </div>
            )}
            {job.data.status === "done" && (
              <div className="flex items-center gap-2 text-green-300">
                <CheckCircle2 className="size-5" /> {t("dash.import.done", { n: fmtNum(job.data.players), rewards: job.data.rewards })}
              </div>
            )}
            {job.data.status === "error" && (
              <div className="flex items-center gap-2 text-red-200">
                <XCircle className="size-5" /> {job.data.error ? t(job.data.error as never, job.data.errorParams) : ""}
              </div>
            )}
          </div>
        )}
        <p className="mt-4 text-xs text-muted">
          {t("dash.import.otherSettings")}
        </p>
      </Card>
    </div>
  );
}
