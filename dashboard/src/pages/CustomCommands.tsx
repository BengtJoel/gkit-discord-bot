import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, TerminalSquare, Trash2 } from "lucide-react";
import { api, fmtNum } from "../lib/api";
import { useGuild, useModuleForm } from "../lib/guild";
import { ModuleShell } from "../components/ModuleShell";
import { Badge, Button, Card, Empty, Field, Modal, RoleMultiSelect, Spinner, TemplateInput, Toggle, useToast } from "../components/ui";

interface Cmd {
  id?: number;
  name: string;
  description: string;
  response: string;
  ephemeral: boolean;
  addRoleIds: string[];
  removeRoleIds: string[];
  allowedRoleIds: string[];
  enabled: boolean;
  uses?: number;
}
const blank: Cmd = { name: "", description: "", response: "", ephemeral: false, addRoleIds: [], removeRoleIds: [], allowedRoleIds: [], enabled: true };

export function CustomCommands() {
  const f = useModuleForm("customCommands");
  const g = useGuild();
  const qc = useQueryClient();
  const toast = useToast();
  const [draft, setDraft] = useState<Cmd | null>(null);
  const list = useQuery({ queryKey: ["cmds", g.id], queryFn: () => api<Cmd[]>(`/guilds/${g.id}/commands`) });
  const save = useMutation({
    mutationFn: (c: Cmd) => (c.id ? api(`/guilds/${g.id}/commands/${c.id}`, { method: "PUT", json: c }) : api(`/guilds/${g.id}/commands`, { method: "POST", json: c })),
    onSuccess: () => {
      toast("Kommandot är sparat och syns direkt i Discord");
      setDraft(null);
      void qc.invalidateQueries({ queryKey: ["cmds", g.id] });
    },
    onError: (e: Error) => toast(e.message, "bad"),
  });
  const del = useMutation({
    mutationFn: (id: number) => api(`/guilds/${g.id}/commands/${id}`, { method: "DELETE" }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["cmds", g.id] }),
  });

  return (
    <ModuleShell
      title="Egna kommandon"
      icon={<TerminalSquare className="size-5" />}
      description="Skapa egna slash-kommandon med svar och rollhantering. De dyker upp i Discord direkt när du sparar."
      form={f}
      actions={<Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setDraft({ ...blank })}>Nytt kommando</Button>}
    >
      <Card padded={false}>
        {list.isLoading ? (
          <div className="grid h-32 place-items-center"><Spinner /></div>
        ) : !list.data?.length ? (
          <Empty icon={<TerminalSquare className="size-5" />} title="Inga egna kommandon">T.ex. /regler, /raidtider eller /addon som svarar med en länk.</Empty>
        ) : (
          <ul className="divide-y divide-line">
            {list.data.map((c) => (
              <li key={c.id} className="group flex items-center gap-4 px-5 py-3">
                <span className="font-mono text-sm font-medium text-accent-2">/{c.name}</span>
                <span className="flex-1 truncate text-sm text-muted">{c.response}</span>
                {!c.enabled && <Badge>Av</Badge>}
                {c.ephemeral && <Badge>Privat svar</Badge>}
                <span className="text-xs text-muted tabular-nums">{fmtNum(c.uses)} anv.</span>
                <Button variant="ghost" size="sm" onClick={() => setDraft(c)}><Pencil className="size-4" /></Button>
                <Button variant="ghost" size="sm" onClick={() => confirm(`Ta bort /${c.name}?`) && del.mutate(c.id!)}><Trash2 className="size-4" /></Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {draft && (
        <Modal
          open
          wide
          onClose={() => setDraft(null)}
          title={draft.id ? `Redigera /${draft.name}` : "Nytt kommando"}
          footer={
            <>
              <Button variant="ghost" onClick={() => setDraft(null)}>Avbryt</Button>
              <Button variant="primary" loading={save.isPending} disabled={!draft.name || !draft.response} onClick={() => save.mutate(draft)}>Spara</Button>
            </>
          }
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Namn" hint="Små bokstäver, siffror, - och _">
              <div className="flex items-center">
                <span className="grid h-9 place-items-center rounded-l-md border border-r-0 border-line bg-panel px-2.5 font-mono text-muted">/</span>
                <input className="input rounded-l-none font-mono" value={draft.name} maxLength={32} onChange={(e) => setDraft({ ...draft, name: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, "") })} />
              </div>
            </Field>
            <Field label="Beskrivning" hint="Visas i Discords kommandolista">
              <input className="input" value={draft.description} maxLength={100} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
            </Field>
          </div>
          <Field label="Svar">
            <TemplateInput
              rows={4}
              value={draft.response}
              onChange={(response) => setDraft({ ...draft, response })}
              variables={[
                { key: "user", label: "Den som körde kommandot" },
                { key: "target", label: "Användaren som valdes i kommandot" },
                { key: "username", label: "Användarnamn" },
                { key: "server", label: "Servernamn" },
                { key: "channel", label: "Kanalen" },
                { key: "membercount", label: "Antal medlemmar" },
              ]}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Ge roller"><RoleMultiSelect value={draft.addRoleIds} onChange={(addRoleIds) => setDraft({ ...draft, addRoleIds })} assignableOnly /></Field>
            <Field label="Ta bort roller"><RoleMultiSelect value={draft.removeRoleIds} onChange={(removeRoleIds) => setDraft({ ...draft, removeRoleIds })} assignableOnly /></Field>
          </div>
          <Field label="Bara för roller" hint="Tomt = alla får använda kommandot.">
            <RoleMultiSelect value={draft.allowedRoleIds} onChange={(allowedRoleIds) => setDraft({ ...draft, allowedRoleIds })} />
          </Field>
          <div className="flex flex-wrap gap-6">
            <label className="flex items-center gap-3 text-sm"><Toggle size="sm" checked={draft.ephemeral} onChange={(ephemeral) => setDraft({ ...draft, ephemeral })} /> Privat svar (syns bara för användaren)</label>
            <label className="flex items-center gap-3 text-sm"><Toggle size="sm" checked={draft.enabled} onChange={(enabled) => setDraft({ ...draft, enabled })} /> Aktivt</label>
          </div>
        </Modal>
      )}
    </ModuleShell>
  );
}
