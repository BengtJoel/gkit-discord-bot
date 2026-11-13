import { useQuery } from "@tanstack/react-query";
import { Settings as Cog } from "lucide-react";
import { api, fmtDateTime } from "../lib/api";
import { useGuild, useModuleForm } from "../lib/guild";
import { ModuleShell } from "../components/ModuleShell";
import { Card, ChannelMultiSelect, Empty, Field, NumberInput, Spinner, Toggle } from "../components/ui";

export function Settings() {
  const f = useModuleForm("activity");
  const g = useGuild();
  const d = f.draft;
  const audit = useQuery({
    queryKey: ["audit", g.id],
    queryFn: () => api<{ id: number; userId: string; action: string; data: Record<string, unknown>; createdAt: string }[]>(`/guilds/${g.id}/audit`),
  });
  return (
    <ModuleShell
      title="Inställningar"
      icon={<Cog className="size-5" />}
      description="Aktivitetsspårning för rapporterna. Boten räknar meddelanden och tid i röst per medlem och dag. Innehållet i meddelanden sparas aldrig."
      form={f}
    >
      <Card title="Aktivitetsspårning">
        <div className="space-y-4">
          <div className="flex items-center justify-between rounded-lg border border-line px-4 py-3">
            <span className="text-sm">Räkna meddelanden</span>
            <Toggle checked={d.trackMessages} onChange={(v) => f.update("trackMessages", v)} />
          </div>
          <div className="flex items-center justify-between rounded-lg border border-line px-4 py-3">
            <span className="text-sm">Räkna tid i röstkanaler (AFK-kanalen räknas inte)</span>
            <Toggle checked={d.trackVoice} onChange={(v) => f.update("trackVoice", v)} />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Field label="Ignorerade kanaler">
              <ChannelMultiSelect value={d.ignoredChannelIds} onChange={(v) => f.update("ignoredChannelIds", v)} types={["text", "voice"]} />
            </Field>
            <Field label="Räkna som inaktiv efter" hint="Används för filtret Inaktiva under Medlemmar.">
              <NumberInput value={d.inactiveDays} min={1} max={365} suffix="dagar" onChange={(v) => f.update("inactiveDays", v)} />
            </Field>
          </div>
        </div>
      </Card>
      <Card title="Ändringslogg" description="Vem som har ändrat vad i dashboarden." padded={false}>
        {audit.isLoading ? (
          <div className="grid h-24 place-items-center"><Spinner /></div>
        ) : !audit.data?.length ? (
          <Empty title="Inga ändringar ännu" />
        ) : (
          <ul className="divide-y divide-line text-sm">
            {audit.data.map((a) => (
              <li key={a.id} className="flex justify-between gap-4 px-5 py-2">
                <span>
                  <span className="font-mono text-xs text-accent-2">{a.action}</span> <span className="text-muted">av {a.userId}</span>
                </span>
                <span className="text-muted">{fmtDateTime(a.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </ModuleShell>
  );
}
