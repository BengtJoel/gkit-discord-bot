import { Mic } from "lucide-react";
import { useModuleForm } from "../lib/guild";
import { ModuleShell } from "../components/ModuleShell";
import { Card, ChannelMultiSelect, ChannelSelect, Field, NumberInput, TemplateInput } from "../components/ui";

export function TempVoice() {
  const f = useModuleForm("tempVoice");
  const d = f.draft;
  return (
    <ModuleShell
      title="Skapa en kanal"
      icon={<Mic className="size-5" />}
      description={
        <>
          När någon går in i en "skapa"-kanal får de en egen röstkanal som försvinner när den blir tom. Ägaren styr den med{" "}
          <span className="kbd">/voice namn</span> <span className="kbd">/voice gräns</span> <span className="kbd">/voice lås</span> <span className="kbd">/voice ta_över</span>.
        </>
      }
      form={f}
    >
      <Card title="Inställningar">
        <div className="grid gap-5 lg:grid-cols-2">
          <Field label="Skapa-kanaler" hint='Röstkanaler som fungerar som knapp, t.ex. "➕ Skapa kanal". Du kan ha flera, t.ex. en per kategori.'>
            <ChannelMultiSelect value={d.hubChannelIds} onChange={(v) => f.update("hubChannelIds", v)} types={["voice"]} placeholder="Välj röstkanaler" />
          </Field>
          <Field label="Kategori för nya kanaler" hint="Tomt = samma kategori som skapa-kanalen.">
            <ChannelSelect value={d.categoryId} onChange={(v) => f.update("categoryId", v)} types={["category"]} placeholder="Samma som skapa-kanalen" />
          </Field>
          <Field label="Namn på nya kanaler">
            <TemplateInput rows={1} value={d.nameTemplate} onChange={(v) => f.update("nameTemplate", v)} variables={[{ key: "displayname", label: "Visningsnamn" }, { key: "username", label: "Användarnamn" }, { key: "user", label: "Visningsnamn" }]} />
          </Field>
          <Field label="Max antal personer" hint="0 = obegränsat">
            <NumberInput value={d.userLimit} min={0} max={99} onChange={(v) => f.update("userLimit", v)} />
          </Field>
        </div>
      </Card>
    </ModuleShell>
  );
}
