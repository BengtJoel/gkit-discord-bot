import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Download, ExternalLink, XCircle } from "lucide-react";
import { api, fmtNum } from "../lib/api";
import { useGuild } from "../lib/guild";
import { Badge, Button, Card, PageHeader, Segmented, Spinner, Toggle, useToast } from "../components/ui";

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
  finishedAt?: string;
}

export function Mee6Import() {
  const g = useGuild();
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
        title="Importera från MEE6"
        icon={<Download className="size-5" />}
        description="Hämtar XP, levels och rollbelöningar från MEE6 så att ingen tappar sin progress. Du kan köra importen flera gånger."
      />

      <Card title="1. Gör MEE6-leaderboarden publik">
        <ol className="list-decimal space-y-1.5 pl-5 text-sm text-muted">
          <li>Öppna MEE6-dashboarden för servern och gå till <b className="text-fg">Leaderboard</b>.</li>
          <li>Slå på <b className="text-fg">“Make my server's leaderboard public”</b> och spara.</li>
          <li>Kom tillbaka hit och klicka på <b className="text-fg">Testa anslutning</b>.</li>
        </ol>
        <div className="mt-4 flex flex-wrap gap-2">
          <a href={`https://mee6.xyz/dashboard/${g.id}/leaderboard`} target="_blank" rel="noreferrer">
            <Button icon={<ExternalLink className="size-4" />}>Öppna MEE6</Button>
          </a>
          <Button variant="primary" loading={preview.isPending} onClick={() => preview.mutate()}>
            Testa anslutning
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
              <CheckCircle2 className="size-5" /> Anslutningen fungerar
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <div className="mb-1 text-xs text-muted uppercase">Topp 10 i MEE6</div>
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
                  <div className="mb-1 text-xs text-muted uppercase">Rollbelöningar</div>
                  {preview.data.roleRewards.length === 0 ? (
                    <span className="text-muted">Inga</span>
                  ) : (
                    preview.data.roleRewards.map((r) => (
                      <div key={`${r.level}-${r.roleId}`} className="flex items-center gap-2">
                        Level {r.level} → {r.roleName ?? roleName(r.roleId) ?? r.roleId}
                        {r.roleId && !g.roles.some((x) => x.id === r.roleId) && <Badge tone="warn">rollen finns inte längre</Badge>}
                      </div>
                    ))
                  )}
                </div>
                <div>
                  <div className="mb-1 text-xs text-muted uppercase">XP-inställningar</div>
                  {preview.data.xpPerMessage ? `${preview.data.xpPerMessage[0]}–${preview.data.xpPerMessage[1]} XP per meddelande` : "—"}
                  {preview.data.xpRate ? ` · ${preview.data.xpRate}× multiplikator` : ""}
                </div>
              </div>
            </div>
          </div>
        )}
      </Card>

      <Card title="2. Välj hur XP ska slås ihop">
        <div className="space-y-4">
          <Segmented
            value={mode}
            onChange={setMode}
            options={[
              { value: "max", label: "Behåll högsta" },
              { value: "replace", label: "Skriv över" },
              { value: "add", label: "Lägg ihop" },
            ]}
          />
          <p className="text-sm text-muted">
            {mode === "max" && "Rekommenderat. Varje medlem får den högsta XP:n av MEE6 och den här boten, så det är säkert att köra flera gånger."}
            {mode === "replace" && "MEE6:s XP ersätter allt den här boten har räknat. Använd om du vill börja om från MEE6."}
            {mode === "add" && "MEE6:s XP läggs ovanpå befintlig XP. Kör bara en gång, annars dubbleras XP:n."}
          </p>
          <div className="flex items-center justify-between rounded-lg border border-line px-4 py-3">
            <span className="text-sm">Importera rollbelöningar</span>
            <Toggle checked={importRewards} onChange={setImportRewards} />
          </div>
          <div className="flex items-center justify-between rounded-lg border border-line px-4 py-3">
            <span className="text-sm">Importera XP per meddelande och multiplikator</span>
            <Toggle checked={importXpSettings} onChange={setImportXpSettings} />
          </div>
        </div>
      </Card>

      <Card title="3. Kör importen">
        <Button variant="primary" icon={<Download className="size-4" />} loading={running || start.isPending} onClick={() => start.mutate()}>
          {running ? "Importerar…" : "Starta import"}
        </Button>
        {job.data && (
          <div className="mt-4 rounded-lg border border-line bg-panel-2/40 p-4 text-sm">
            {job.data.status === "running" && (
              <div className="flex items-center gap-2">
                <Spinner className="size-4" /> Hämtar sida {job.data.pages + 1}… {fmtNum(job.data.players)} medlemmar hittills
              </div>
            )}
            {job.data.status === "done" && (
              <div className="flex items-center gap-2 text-green-300">
                <CheckCircle2 className="size-5" /> Klart! {fmtNum(job.data.players)} medlemmar och {job.data.rewards} rollbelöningar importerades.
              </div>
            )}
            {job.data.status === "error" && (
              <div className="flex items-center gap-2 text-red-200">
                <XCircle className="size-5" /> {job.data.error}
              </div>
            )}
          </div>
        )}
        <p className="mt-4 text-xs text-muted">
          Övriga MEE6-inställningar (välkomstmeddelanden, reaction roles, kommandon m.m.) finns inte i något publikt API. Ställ in dem
          på respektive sida, och för reaction roles kan du koppla den nya modulen till MEE6:s befintliga meddelande via meddelande-ID, så
          att medlemmarnas reaktioner ligger kvar.
        </p>
      </Card>
    </div>
  );
}
