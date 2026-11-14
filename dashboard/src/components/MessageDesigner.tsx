import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { ImagePlus, Link2, Plus, Trash2, Upload, X } from "lucide-react";
import { api, avatarUrl, guildIconUrl } from "../lib/api";
import { useGuild } from "../lib/guild";
import { useT } from "../lib/i18n";
import { useMe } from "../pages/ServerPicker";
import { Button, Field, Segmented, TemplateInput, Toggle, useToast } from "./ui";

/** Mirror of server/src/lib/design.ts */
export interface EmbedDesign {
  enabled: boolean;
  title: string;
  url: string;
  description: string;
  color: string | null;
  author: "none" | "member" | "server";
  thumbnail: "none" | "member" | "server";
  fields: { name: string; value: string; inline: boolean }[];
  footer: string;
  timestamp: boolean;
}
export interface CardDesign {
  enabled: boolean;
  layout: "center" | "left";
  title: string;
  subtitle: string;
  textColor: string;
  accentColor: string | null;
  overlay: number;
}
export interface Design {
  message: string;
  embed: EmbedDesign;
  image: { mediaId: number | null; url: string; card: CardDesign };
}
export const blankCard = (): CardDesign => ({ enabled: false, layout: "center", title: "", subtitle: "", textColor: "#ffffff", accentColor: null, overlay: 35 });

export const blankEmbed = (): EmbedDesign => ({
  enabled: false,
  title: "",
  url: "",
  description: "",
  color: null,
  author: "none",
  thumbnail: "none",
  fields: [],
  footer: "",
  timestamp: false,
});
export const blankDesign = (): Design => ({ message: "", embed: blankEmbed(), image: { mediaId: null, url: "", card: blankCard() } });

const MAX_MB = 8;

function readFile(file: File) {
  return new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

export const mediaUrl = (guildId: string, id: number) => `/api/guilds/${guildId}/media/${id}`;

/** Server-rendered welcome card (with you as the new member), refreshed shortly after each change */
function useCardPreview(image: Design["image"], active: boolean) {
  const g = useGuild();
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const key = JSON.stringify(image);
  useEffect(() => {
    if (!active) return setUrl(null);
    let cancelled = false;
    let made: string | null = null;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/guilds/${g.id}/card-preview`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ image }), credentials: "same-origin" });
        if (res.ok && !cancelled) {
          made = URL.createObjectURL(await res.blob());
          setUrl(made);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      if (made) setTimeout(() => URL.revokeObjectURL(made!), 2000);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, active, g.id]);
  return { url, loading };
}

/**
 * Editor for a message: text, optional embed and a banner image, with a Discord-style preview.
 * `withMember` = the message is about a member (welcome), so member variables and options are offered.
 */
export function MessageDesigner({
  value,
  onChange,
  vars,
  placeholder,
  withMember = true,
  extra,
}: {
  value: Design;
  onChange: (d: Design) => void;
  vars: { key: string; label: string }[];
  placeholder?: string;
  withMember?: boolean;
  extra?: ReactNode;
}) {
  const { t } = useT();
  const e = value.embed;
  const setEmbed = (p: Partial<EmbedDesign>) => onChange({ ...value, embed: { ...e, ...p } });
  const g = useGuild();
  const card = { ...blankCard(), ...(value.image.card ?? {}) };
  const cardOn = withMember && card.enabled;
  const preview = useCardPreview({ ...value.image, card }, cardOn);
  const subjects = (["none", ...(withMember ? (["member"] as const) : []), "server"] as const).map((v) => ({ value: v, label: t(`dash.design.subject.${v}`) }));

  return (
    <div className="@container">
    <div className="grid gap-5 @4xl:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
      <div className="min-w-0 space-y-4">
        <Field label={t("dash.design.text")} hint={e.enabled ? t("dash.design.textHintEmbed") : undefined}>
          <TemplateInput value={value.message} placeholder={e.enabled ? "" : placeholder} onChange={(message) => onChange({ ...value, message })} variables={vars} rows={3} />
        </Field>

        <div className="rounded-lg border border-line">
          <label className="flex cursor-pointer items-center justify-between gap-3 px-4 py-3">
            <div>
              <div className="text-sm font-medium">{t("dash.design.useEmbed")}</div>
              <div className="text-[13px] text-muted">{t("dash.design.useEmbedHint")}</div>
            </div>
            <Toggle checked={e.enabled} onChange={(enabled) => setEmbed({ enabled, color: e.color ?? g.modules.branding.config.color })} />
          </label>
          {e.enabled && (
            <div className="space-y-3 border-t border-line p-4">
              <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                <Field label={t("dash.design.title")}>
                  <input className="input" value={e.title} maxLength={256} onChange={(ev) => setEmbed({ title: ev.target.value })} />
                </Field>
                <Field label={t("dash.rr.color")}>
                  <input type="color" className="h-9 w-14 cursor-pointer rounded-md border border-line bg-panel-2 p-1" value={e.color ?? g.modules.branding.config.color} onChange={(ev) => setEmbed({ color: ev.target.value })} />
                </Field>
              </div>
              <Field label={t("dash.common.description")}>
                <TemplateInput value={e.description} placeholder={value.message ? "" : placeholder} onChange={(description) => setEmbed({ description })} variables={vars} rows={4} />
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={t("dash.design.author")}>
                  <Segmented value={e.author} onChange={(author) => setEmbed({ author })} options={subjects} />
                </Field>
                <Field label={t("dash.design.thumbnail")}>
                  <Segmented value={e.thumbnail} onChange={(thumbnail) => setEmbed({ thumbnail })} options={subjects} />
                </Field>
              </div>
              <FieldsEditor value={e.fields} onChange={(fields) => setEmbed({ fields })} />
              <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
                <Field label={t("dash.design.footer")}>
                  <input className="input" value={e.footer} maxLength={2048} onChange={(ev) => setEmbed({ footer: ev.target.value })} />
                </Field>
                <label className="flex h-9 items-center gap-2 text-sm"><Toggle size="sm" checked={e.timestamp} onChange={(timestamp) => setEmbed({ timestamp })} /> {t("dash.design.timestamp")}</label>
              </div>
              <Field label={t("dash.design.titleUrl")}>
                <input className="input" value={e.url} placeholder="https://" onChange={(ev) => setEmbed({ url: ev.target.value.trim() })} />
              </Field>
            </div>
          )}
        </div>

        <ImagePicker value={value.image} onChange={(image) => onChange({ ...value, image: { ...image, card } })} cardOn={cardOn} />
        {withMember && <CardEditor value={card} onChange={(c) => onChange({ ...value, image: { ...value.image, card: c } })} vars={vars} />}
        {extra}
      </div>
      <div className="min-w-0">
        <div className="label">{t("dash.design.preview")}</div>
        <div className="@4xl:sticky @4xl:top-4">
          <Preview design={value} placeholder={placeholder} withMember={withMember} cardUrl={cardOn ? (preview.url ?? "") : null} />
          {cardOn && preview.loading && <p className="hint mt-2">{t("dash.design.card.rendering")}</p>}
        </div>
      </div>
    </div>
    </div>
  );
}

function FieldsEditor({ value, onChange }: { value: EmbedDesign["fields"]; onChange: (f: EmbedDesign["fields"]) => void }) {
  const { t } = useT();
  return (
    <div>
      <div className="label">{t("dash.design.fields")}</div>
      <div className="space-y-2">
        {value.map((f, i) => {
          const up = (p: Partial<typeof f>) => onChange(value.map((x, j) => (j === i ? { ...x, ...p } : x)));
          return (
            <div key={i} className="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)_auto_auto] items-center gap-2">
              <input className="input" value={f.name} maxLength={256} placeholder={t("dash.design.fieldName")} onChange={(ev) => up({ name: ev.target.value })} />
              <input className="input" value={f.value} maxLength={1024} placeholder={t("dash.design.fieldValue")} onChange={(ev) => up({ value: ev.target.value })} />
              <label className="flex h-9 items-center gap-1.5 text-xs whitespace-nowrap text-muted" title={t("dash.design.inline")}><input type="checkbox" checked={f.inline} onChange={(ev) => up({ inline: ev.target.checked })} /> {t("dash.design.inline")}</label>
              <button type="button" className="p-1 text-muted hover:text-red-300" onClick={() => onChange(value.filter((_, j) => j !== i))}><X className="size-3.5" /></button>
            </div>
          );
        })}
      </div>
      {value.length < 25 && (
        <Button size="sm" className="mt-2" icon={<Plus className="size-4" />} onClick={() => onChange([...value, { name: "", value: "", inline: true }])}>
          {t("dash.design.addField")}
        </Button>
      )}
    </div>
  );
}

function ImagePicker({ value, onChange, cardOn }: { value: Design["image"]; onChange: (v: Omit<Design["image"], "card">) => void; cardOn: boolean }) {
  const { t } = useT();
  const g = useGuild();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"upload" | "url">(value.url ? "url" : "upload");
  const has = value.mediaId || value.url;

  const upload = async (file?: File) => {
    if (!file) return;
    if (file.size > MAX_MB * 1024 * 1024) return toast(t("errors.imageTooLarge", { mb: MAX_MB }), "bad");
    setBusy(true);
    try {
      const res = await api<{ id: number }>(`/guilds/${g.id}/media`, { method: "POST", json: { image: await readFile(file), name: file.name } });
      onChange({ mediaId: res.id, url: "" });
    } catch (e) {
      toast((e as Error).message, "bad");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border border-line p-4">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium">{t(cardOn ? "dash.design.card.background" : "dash.design.banner")}</div>
          <div className="text-[13px] text-muted">{t(cardOn ? "dash.design.card.backgroundHint" : "dash.design.bannerHint")}</div>
        </div>
        {has ? (
          <Button size="sm" variant="ghost" icon={<Trash2 className="size-4" />} onClick={() => onChange({ mediaId: null, url: "" })}>{t("dash.design.removeImage")}</Button>
        ) : (
          <Segmented value={mode} onChange={setMode} options={[{ value: "upload", label: t("dash.design.upload") }, { value: "url", label: t("dash.design.link") }]} />
        )}
      </div>
      {value.mediaId ? (
        <img src={mediaUrl(g.id, value.mediaId)} alt="" className="max-h-40 rounded-md border border-line object-contain" />
      ) : mode === "url" || value.url ? (
        <div className="flex items-center gap-2">
          <Link2 className="size-4 shrink-0 text-muted" />
          <input className="input" value={value.url} placeholder="https://…/banner.png" onChange={(ev) => onChange({ mediaId: null, url: ev.target.value.trim() })} />
        </div>
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={() => input.current?.click()}
          onDragOver={(ev) => ev.preventDefault()}
          onDrop={(ev) => {
            ev.preventDefault();
            void upload(ev.dataTransfer.files?.[0]);
          }}
          className="flex w-full flex-col items-center gap-1.5 rounded-md border border-dashed border-line-2 px-4 py-6 text-sm text-muted transition hover:border-accent hover:text-fg"
        >
          {busy ? <Upload className="size-5 animate-pulse" /> : <ImagePlus className="size-5" />}
          {t("dash.design.dropImage")}
          <span className="text-xs">{t("dash.design.imageLimits", { mb: MAX_MB })}</span>
        </button>
      )}
      <input ref={input} type="file" accept="image/png,image/jpeg,image/gif,image/webp" className="hidden" onChange={(ev) => (void upload(ev.target.files?.[0]), (ev.target.value = ""))} />
    </div>
  );
}

/* ------------------------------------------------------------ preview */

/** Rough Discord markdown: bold, italic, underline, strike, inline code, links, line breaks */
function md(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|_[^_]+_|~~[^~]+~~|`[^`]+`|\[[^\]]+\]\([^)]+\)|<@[!&]?\d+>|@\S+)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const s = m[0];
    if (s.startsWith("**")) out.push(<strong key={k++}>{s.slice(2, -2)}</strong>);
    else if (s.startsWith("__")) out.push(<u key={k++}>{s.slice(2, -2)}</u>);
    else if (s.startsWith("~~")) out.push(<s key={k++}>{s.slice(2, -2)}</s>);
    else if (s.startsWith("`")) out.push(<code key={k++} className="rounded bg-black/30 px-1 text-[0.85em]">{s.slice(1, -1)}</code>);
    else if (s.startsWith("[")) out.push(<span key={k++} className="text-sky-400">{s.slice(1, s.indexOf("]"))}</span>);
    else if (s.startsWith("@") || s.startsWith("<@")) out.push(<span key={k++} className="rounded bg-indigo-500/30 px-0.5 text-indigo-200">{s.startsWith("<") ? "@member" : s}</span>);
    else out.push(<em key={k++}>{s.slice(1, -1)}</em>);
    last = m.index + s.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function Preview({ design, placeholder, withMember, cardUrl }: { design: Design; placeholder?: string; withMember: boolean; cardUrl: string | null }) {
  const g = useGuild();
  const { t } = useT();
  const me = useMe().data?.user;
  const brand = useQuery({ queryKey: ["branding", g.id], queryFn: () => api<{ profile: { username: string; nickname: string | null; avatarUrl: string | null; globalAvatarUrl: string | null } | null }>(`/guilds/${g.id}/branding`), staleTime: 60_000 });
  const bot = brand.data?.profile;
  const name = me?.username ?? "member";
  const memberAvatar = me ? avatarUrl(me.id, me.avatar, 128) : undefined;
  const serverIcon = g.icon ? guildIconUrl(g.id, g.icon, 128) : undefined;
  const fill = (s: string) =>
    s
      .replace(/\{(user|user\.mention)\}/g, withMember ? `@${name}` : "")
      .replace(/\{(username|user\.name)\}/g, withMember ? name : "")
      .replace(/\{displayname\}/g, withMember ? name : "")
      .replace(/\{(server|server\.name)\}/g, g.name ?? "")
      .replace(/\{(membercount|server\.member_count)\}/g, String(g.memberCount))
      .replace(/\{channel\}/g, "#general");
  const e = design.embed;
  const imgSrc = cardUrl !== null ? cardUrl || null : design.image.mediaId ? mediaUrl(g.id, design.image.mediaId) : design.image.url || null;
  const text = design.message || (!e.enabled ? (placeholder ?? "") : "");
  const desc = e.description || (!design.message ? (placeholder ?? "") : "");
  const color = e.color ?? g.modules.branding.config.color;
  const subj = (s: "none" | "member" | "server") => (s === "member" ? { name, icon: memberAvatar } : s === "server" ? { name: g.name ?? "", icon: serverIcon } : null);
  const author = subj(e.author);
  const thumb = subj(e.thumbnail)?.icon;

  return (
    <div className="rounded-lg bg-[#313338] p-4 font-[system-ui] text-[15px] leading-[1.375] text-[#dbdee1]">
      <div className="flex gap-4">
        {bot?.avatarUrl || bot?.globalAvatarUrl ? (
          <img src={bot.avatarUrl ?? bot.globalAvatarUrl ?? ""} alt="" className="size-10 shrink-0 rounded-full" />
        ) : (
          <div className="size-10 shrink-0 rounded-full bg-accent" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="font-medium text-white">{bot?.nickname || bot?.username || "Bot"}</span>
            <span className="rounded bg-[#5865f2] px-1 text-[10px] font-semibold text-white">APP</span>
            <span className="text-xs text-[#949ba4]">{t("dash.design.today")}</span>
          </div>
          {text && <div className="whitespace-pre-wrap break-words">{md(fill(text))}</div>}
          {e.enabled && (
            <div className="mt-1 grid max-w-[432px] rounded border-l-4 bg-[#2b2d31] py-2 pr-4 pl-3" style={{ borderColor: color }}>
              <div className="flex gap-4">
                <div className="min-w-0 flex-1 space-y-1">
                  {author && (
                    <div className="flex items-center gap-2 text-sm font-semibold text-white">
                      {author.icon && <img src={author.icon} alt="" className="size-6 rounded-full" />}
                      {author.name}
                    </div>
                  )}
                  {e.title && <div className={clsx("font-semibold", e.url ? "text-sky-400" : "text-white")}>{fill(e.title)}</div>}
                  {desc && <div className="whitespace-pre-wrap break-words text-sm">{md(fill(desc))}</div>}
                  {e.fields.length > 0 && (
                    <div className="grid grid-cols-3 gap-x-4 gap-y-2 pt-1">
                      {e.fields.map((f, i) => (
                        <div key={i} className={clsx("min-w-0 text-sm", !f.inline && "col-span-3")}>
                          <div className="font-semibold text-white">{fill(f.name) || "…"}</div>
                          <div className="whitespace-pre-wrap break-words">{md(fill(f.value)) }</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                {thumb && <img src={thumb} alt="" className="size-20 shrink-0 rounded object-cover" />}
              </div>
              {imgSrc && <img src={imgSrc} alt="" className="mt-3 block h-auto w-full rounded" />}
              {(e.footer || e.timestamp) && (
                <div className="mt-2 text-xs text-[#b5bac1]">
                  {fill(e.footer)}
                  {e.footer && e.timestamp && " • "}
                  {e.timestamp && t("dash.design.today")}
                </div>
              )}
            </div>
          )}
          {!e.enabled && imgSrc && <img src={imgSrc} alt="" className="mt-1 block h-auto w-full max-w-[432px] rounded-lg" />}
        </div>
      </div>
    </div>
  );
}

function CardEditor({ value: c, onChange, vars }: { value: CardDesign; onChange: (c: CardDesign) => void; vars: { key: string; label: string }[] }) {
  const { t } = useT();
  const g = useGuild();
  const set = (p: Partial<CardDesign>) => onChange({ ...c, ...p });
  const cardVars = vars.filter((v) => v.key !== "user");
  return (
    <div className="rounded-lg border border-line">
      <label className="flex cursor-pointer items-center justify-between gap-3 px-4 py-3">
        <div>
          <div className="text-sm font-medium">{t("dash.design.card.title")}</div>
          <div className="text-[13px] text-muted">{t("dash.design.card.hint")}</div>
        </div>
        <Toggle checked={c.enabled} onChange={(enabled) => set({ enabled })} />
      </label>
      {c.enabled && (
        <div className="space-y-3 border-t border-line p-4">
          <Field label={t("dash.design.card.layout")}>
            <Segmented value={c.layout} onChange={(layout) => set({ layout })} options={[{ value: "center", label: t("dash.design.card.center") }, { value: "left", label: t("dash.design.card.left") }]} />
          </Field>
          <Field label={t("dash.design.card.heading")}>
            <TemplateInput value={c.title} onChange={(title) => set({ title })} variables={cardVars} rows={1} placeholder={t("defaults.cardTitle")} />
          </Field>
          <Field label={t("dash.design.card.subheading")}>
            <TemplateInput value={c.subtitle} onChange={(subtitle) => set({ subtitle })} variables={cardVars} rows={1} placeholder={t("defaults.cardSubtitle")} />
          </Field>
          <div className="flex flex-wrap items-end gap-4">
            <Field label={t("dash.design.card.textColor")}>
              <input type="color" className="h-9 w-14 cursor-pointer rounded-md border border-line bg-panel-2 p-1" value={c.textColor} onChange={(e) => set({ textColor: e.target.value })} />
            </Field>
            <Field label={t("dash.design.card.ring")}>
              <input type="color" className="h-9 w-14 cursor-pointer rounded-md border border-line bg-panel-2 p-1" value={c.accentColor ?? g.modules.branding.config.color} onChange={(e) => set({ accentColor: e.target.value })} />
            </Field>
            <Field label={t("dash.design.card.overlay", { n: c.overlay })} className="min-w-48 flex-1">
              <input type="range" min={0} max={90} step={5} value={c.overlay} onChange={(e) => set({ overlay: Number(e.target.value) })} className="w-full accent-[var(--color-accent,#8b5cf6)]" />
            </Field>
          </div>
        </div>
      )}
    </div>
  );
}
