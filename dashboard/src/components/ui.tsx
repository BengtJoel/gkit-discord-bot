import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";
import { Check, ChevronDown, Hash, Loader2, Search, Volume2, X, Folder, MessagesSquare } from "lucide-react";
import type { Channel, Role } from "../lib/types";
import { useT, tr } from "../lib/i18n";

/* ---------------- Buttons ---------------- */

type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
  loading?: boolean;
  icon?: ReactNode;
};
export function Button({ variant = "secondary", size = "md", loading, icon, className, children, disabled, ...rest }: BtnProps) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={clsx(
        "inline-flex items-center justify-center gap-2 rounded-md font-medium transition select-none disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" ? "h-8 px-3 text-[13px]" : "h-9 px-4 text-sm",
        variant === "primary" && "bg-accent text-white shadow-[0_0_0_1px_rgba(255,255,255,.08)_inset] hover:bg-accent/90",
        variant === "secondary" && "border border-line-2 bg-panel-2 text-fg hover:border-faint hover:bg-line/60",
        variant === "ghost" && "text-muted hover:bg-panel-2 hover:text-fg",
        variant === "danger" && "border border-bad/30 bg-bad/10 text-red-300 hover:bg-bad/20",
        className,
      )}
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  );
}

/* ---------------- Toggle ---------------- */

export function Toggle({ checked, onChange, disabled, size = "md" }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; size?: "sm" | "md" }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={clsx(
        "relative inline-flex shrink-0 items-center rounded-full transition disabled:opacity-50",
        size === "sm" ? "h-5 w-9" : "h-6 w-11",
        checked ? "bg-accent" : "bg-line-2",
      )}
    >
      <span
        className={clsx(
          "inline-block rounded-full bg-white shadow transition",
          size === "sm" ? "size-4" : "size-5",
          checked ? (size === "sm" ? "translate-x-[18px]" : "translate-x-[22px]") : "translate-x-0.5",
        )}
      />
    </button>
  );
}

/* ---------------- Layout bits ---------------- */

export function PageHeader({ title, description, actions, icon }: { title: string; description?: ReactNode; actions?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div className="flex items-start gap-3">
        {icon && <div className="mt-0.5 grid size-10 place-items-center rounded-lg border border-line bg-panel text-accent-2">{icon}</div>}
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          {description && <p className="mt-1 max-w-2xl text-sm text-muted">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, description, actions, children, className, padded = true }: { title?: ReactNode; description?: ReactNode; actions?: ReactNode; children?: ReactNode; className?: string; padded?: boolean }) {
  return (
    <section className={clsx("card", className)}>
      {(title || actions) && (
        <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div>
            {title && <h2 className="text-[15px] font-semibold">{title}</h2>}
            {description && <p className="mt-0.5 text-[13px] text-muted">{description}</p>}
          </div>
          {actions}
        </header>
      )}
      <div className={clsx(padded && "p-5")}>{children}</div>
    </section>
  );
}

export function Field({ label, hint, children, className }: { label?: ReactNode; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      {label && <label className="label">{label}</label>}
      {children}
      {hint && <p className="hint">{hint}</p>}
    </div>
  );
}

export function ToggleRow({ title, description, checked, onChange, children }: { title: ReactNode; description?: ReactNode; checked: boolean; onChange: (v: boolean) => void; children?: ReactNode }) {
  return (
    <div className="rounded-lg border border-line bg-panel-2/40">
      <div className="flex items-center justify-between gap-4 px-4 py-3">
        <div>
          <div className="text-sm font-medium">{title}</div>
          {description && <div className="mt-0.5 text-[13px] text-muted">{description}</div>}
        </div>
        <Toggle checked={checked} onChange={onChange} />
      </div>
      {checked && children && <div className="space-y-4 border-t border-line px-4 py-4">{children}</div>}
    </div>
  );
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "accent" | "ok" | "warn" | "bad" }) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium",
        tone === "neutral" && "border-line-2 bg-panel-2 text-muted",
        tone === "accent" && "border-accent/30 bg-accent/10 text-accent-2",
        tone === "ok" && "border-ok/30 bg-ok/10 text-green-300",
        tone === "warn" && "border-warn/30 bg-warn/10 text-amber-300",
        tone === "bad" && "border-bad/30 bg-bad/10 text-red-300",
      )}
    >
      {children}
    </span>
  );
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      {icon && <div className="mb-3 grid size-12 place-items-center rounded-full border border-line bg-panel-2 text-muted">{icon}</div>}
      <div className="font-medium">{title}</div>
      {children && <div className="mt-1 max-w-sm text-sm text-muted">{children}</div>}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={clsx("size-5 animate-spin text-muted", className)} />;
}

export function NumberInput({ value, onChange, min, max, step, suffix }: { value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; suffix?: string }) {
  return (
    <div className="relative">
      <input
        type="number"
        className={clsx("input", suffix && "pr-12")}
        value={Number.isFinite(value) ? value : ""}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(e.target.value === "" ? 0 : Number(e.target.value))}
      />
      {suffix && <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-muted">{suffix}</span>}
    </div>
  );
}

export function Select<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return (
    <div className="relative">
      <select className="input appearance-none pr-8" value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted" />
    </div>
  );
}

/** Segmented control for 2-4 options */
export function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return (
    <div className="inline-flex rounded-lg border border-line bg-panel-2 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={clsx(
            "rounded-md px-3 py-1.5 text-[13px] font-medium transition",
            value === o.value ? "bg-line-2 text-fg shadow-sm" : "text-muted hover:text-fg",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ---------------- Searchable picker (channels / roles) ---------------- */

interface PickerItem {
  id: string;
  label: string;
  icon?: ReactNode;
  group?: string;
  color?: string;
  disabled?: boolean;
  note?: string;
}

function usePopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return { open, setOpen, ref };
}

function Picker({
  items,
  selected,
  onToggle,
  multiple,
  placeholder,
  renderSelected,
  clearable,
  onClear,
}: {
  items: PickerItem[];
  selected: string[];
  onToggle: (id: string) => void;
  multiple?: boolean;
  placeholder: string;
  renderSelected: (item: PickerItem) => ReactNode;
  clearable?: boolean;
  onClear?: () => void;
}) {
  const { open, setOpen, ref } = usePopover();
  const { t } = useT();
  const [q, setQ] = useState("");
  const filtered = useMemo(() => items.filter((i) => i.label.toLowerCase().includes(q.toLowerCase())), [items, q]);
  const sel = selected.map((id) => items.find((i) => i.id === id) ?? { id, label: t("dash.common.unknownItem", { id: id.slice(-4) }) });
  let lastGroup: string | undefined;

  return (
    <div ref={ref} className="relative">
      <div
        role="button"
        tabIndex={0}
        onClick={() => setOpen(!open)}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setOpen(!open)}
        className={clsx(
          "flex min-h-9 w-full cursor-pointer flex-wrap items-center gap-1.5 rounded-md border bg-panel-2 px-2 py-1 pr-8 text-sm transition",
          open ? "border-accent ring-2 ring-accent/25" : "border-line hover:border-line-2",
        )}
      >
        {sel.length === 0 && <span className="px-1 text-faint">{placeholder}</span>}
        {sel.map((s) =>
          multiple ? (
            <span key={s.id} className="inline-flex items-center gap-1 rounded border border-line-2 bg-panel py-0.5 pr-1 pl-1.5 text-[13px]">
              {renderSelected(s)}
              <X
                className="size-3.5 text-muted hover:text-fg"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggle(s.id);
                }}
              />
            </span>
          ) : (
            <span key={s.id} className="inline-flex items-center gap-1.5 px-1">
              {renderSelected(s)}
            </span>
          ),
        )}
        <div className="absolute top-1/2 right-2 flex -translate-y-1/2 items-center gap-1">
          {clearable && sel.length > 0 && (
            <X
              className="size-4 text-muted hover:text-fg"
              onClick={(e) => {
                e.stopPropagation();
                onClear?.();
              }}
            />
          )}
          <ChevronDown className="size-4 text-muted" />
        </div>
      </div>
      {open && (
        <div className="absolute z-30 mt-1 w-full min-w-64 overflow-hidden rounded-lg border border-line-2 bg-panel shadow-2xl shadow-black/60">
          <div className="flex items-center gap-2 border-b border-line px-3">
            <Search className="size-4 text-muted" />
            <input autoFocus className="h-9 w-full bg-transparent text-sm outline-none placeholder:text-faint" placeholder={t("dash.common.search")} value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="max-h-72 overflow-y-auto p-1">
            {filtered.length === 0 && <div className="px-3 py-6 text-center text-sm text-muted">{t("dash.common.noMatches")}</div>}
            {filtered.map((i) => {
              const header = i.group !== lastGroup && i.group ? i.group : null;
              lastGroup = i.group;
              const isSel = selected.includes(i.id);
              return (
                <div key={i.id}>
                  {header && <div className="px-2 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-faint uppercase">{header}</div>}
                  <button
                    type="button"
                    disabled={i.disabled}
                    onClick={() => {
                      onToggle(i.id);
                      if (!multiple) setOpen(false);
                    }}
                    className={clsx(
                      "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition disabled:opacity-40",
                      isSel ? "bg-accent/15 text-fg" : "hover:bg-panel-2",
                    )}
                  >
                    {i.icon}
                    <span className="flex-1 truncate">{i.label}</span>
                    {i.note && <span className="text-[11px] text-faint">{i.note}</span>}
                    {isSel && <Check className="size-4 text-accent-2" />}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------- Guild data context for pickers ---------------- */

export const GuildDataContext = createContext<{ channels: Channel[]; roles: Role[] }>({ channels: [], roles: [] });

const channelIcon = (t: Channel["type"]) =>
  t === "voice" ? <Volume2 className="size-4 text-muted" /> : t === "category" ? <Folder className="size-4 text-muted" /> : t === "forum" ? <MessagesSquare className="size-4 text-muted" /> : <Hash className="size-4 text-muted" />;

function channelItems(channels: Channel[], types: Channel["type"][]): PickerItem[] {
  const cats = new Map(channels.filter((c) => c.type === "category").map((c) => [c.id, c]));
  const list = channels.filter((c) => types.includes(c.type));
  // order: uncategorised first, then by category position
  return list
    .map((c) => ({ c, cat: c.parentId ? cats.get(c.parentId) : undefined }))
    .sort((a, b) => (a.cat?.position ?? -1) - (b.cat?.position ?? -1) || a.c.position - b.c.position)
    .map(({ c, cat }) => ({ id: c.id, label: c.name, icon: channelIcon(c.type), group: c.type === "category" ? tr("dash.pickers.categories") : (cat?.name ?? tr("dash.pickers.noCategory")) }));
}

export function ChannelSelect({ value, onChange, types = ["text"], placeholder, clearable = true }: { value: string | null; onChange: (v: string | null) => void; types?: Channel["type"][]; placeholder?: string; clearable?: boolean }) {
  const { channels } = useContext(GuildDataContext);
  const items = useMemo(() => channelItems(channels, types), [channels, types]);
  return (
    <Picker
      items={items}
      selected={value ? [value] : []}
      onToggle={(id) => onChange(id)}
      placeholder={placeholder ?? tr("dash.pickers.channel")}
      clearable={clearable}
      onClear={() => onChange(null)}
      renderSelected={(i) => (
        <>
          {i.icon ?? <Hash className="size-4 text-muted" />}
          {i.label}
        </>
      )}
    />
  );
}

export function ChannelMultiSelect({ value, onChange, types = ["text"], placeholder }: { value: string[]; onChange: (v: string[]) => void; types?: Channel["type"][]; placeholder?: string }) {
  const { channels } = useContext(GuildDataContext);
  const items = useMemo(() => channelItems(channels, types), [channels, types]);
  return (
    <Picker
      multiple
      items={items}
      selected={value}
      onToggle={(id) => onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id])}
      placeholder={placeholder ?? tr("dash.pickers.channels")}
      renderSelected={(i) => (
        <>
          {i.icon ?? <Hash className="size-3.5 text-muted" />}
          {i.label}
        </>
      )}
    />
  );
}

const roleDot = (color?: string) => <span className="size-2.5 shrink-0 rounded-full" style={{ background: color && color !== "#000000" ? color : "#8b8b96" }} />;

export function RoleMultiSelect({ value, onChange, placeholder, assignableOnly }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string; assignableOnly?: boolean }) {
  const { roles } = useContext(GuildDataContext);
  const items = roles
    .filter((r) => !r.managed)
    .map((r) => ({
      id: r.id,
      label: r.name,
      color: r.color,
      icon: roleDot(r.color),
      disabled: assignableOnly && !r.assignable,
      note: assignableOnly && !r.assignable ? tr("dash.pickers.aboveBot") : undefined,
    }));
  return (
    <Picker
      multiple
      items={items}
      selected={value}
      onToggle={(id) => onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id])}
      placeholder={placeholder ?? tr("dash.pickers.roles")}
      renderSelected={(i) => (
        <>
          {roleDot(i.color)}
          {i.label}
        </>
      )}
    />
  );
}

export function RoleSelect({ value, onChange, placeholder, assignableOnly = true }: { value: string | null; onChange: (v: string) => void; placeholder?: string; assignableOnly?: boolean }) {
  const { roles } = useContext(GuildDataContext);
  const items = roles
    .filter((r) => !r.managed)
    .map((r) => ({ id: r.id, label: r.name, color: r.color, icon: roleDot(r.color), disabled: assignableOnly && !r.assignable, note: assignableOnly && !r.assignable ? tr("dash.pickers.aboveBot") : undefined }));
  return (
    <Picker
      items={items}
      selected={value ? [value] : []}
      onToggle={onChange}
      placeholder={placeholder ?? tr("dash.pickers.role")}
      renderSelected={(i) => (
        <>
          {roleDot(i.color)}
          {i.label}
        </>
      )}
    />
  );
}

/* ---------------- Template textarea with variable chips ---------------- */

export function TemplateInput({ value, onChange, variables, rows = 3, placeholder }: { value: string; onChange: (v: string) => void; variables: { key: string; label: string }[]; rows?: number; placeholder?: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const insert = (k: string) => {
    const el = ref.current;
    const token = `{${k}}`;
    if (!el) return onChange(value + token);
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? value.length;
    onChange(value.slice(0, start) + token + value.slice(end));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  };
  return (
    <div>
      <textarea ref={ref} className="input resize-y" rows={rows} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      <div className="mt-1.5 flex flex-wrap gap-1">
        {variables.map((v) => (
          <button key={v.key} type="button" onClick={() => insert(v.key)} title={v.label} className="kbd transition hover:border-accent hover:text-accent-2">
            {`{${v.key}}`}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Editable list of strings shown as chips (words, domains) */
export function TagInput({ value, onChange, placeholder }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const parts = draft.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
    if (parts.length) onChange([...new Set([...value, ...parts])]);
    setDraft("");
  };
  return (
    <div className="flex min-h-9 flex-wrap items-center gap-1.5 rounded-md border border-line bg-panel-2 px-2 py-1 focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/25">
      {value.map((t) => (
        <span key={t} className="inline-flex items-center gap-1 rounded border border-line-2 bg-panel py-0.5 pr-1 pl-1.5 text-[13px]">
          {t}
          <X className="size-3.5 cursor-pointer text-muted hover:text-fg" onClick={() => onChange(value.filter((v) => v !== t))} />
        </span>
      ))}
      <input
        className="h-7 min-w-32 flex-1 bg-transparent px-1 text-sm outline-none placeholder:text-faint"
        value={draft}
        placeholder={value.length ? "" : placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            add();
          } else if (e.key === "Backspace" && !draft && value.length) onChange(value.slice(0, -1));
        }}
        onBlur={add}
      />
    </div>
  );
}

/* ---------------- Modal / drawer ---------------- */

export function Modal({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", k);
    return () => document.removeEventListener("keydown", k);
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 pt-[8vh] backdrop-blur-sm" onMouseDown={onClose}>
      <div className={clsx("card w-full shadow-2xl", wide ? "max-w-3xl" : "max-w-lg")} onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h3 className="font-semibold">{title}</h3>
          <button onClick={onClose} className="text-muted hover:text-fg">
            <X className="size-5" />
          </button>
        </div>
        <div className="space-y-4 p-5">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function Drawer({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", k);
    return () => document.removeEventListener("keydown", k);
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-[2px]" onMouseDown={onClose}>
      <aside className="absolute top-0 right-0 flex h-full w-full max-w-xl flex-col border-l border-line bg-panel shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <div className="font-semibold">{title}</div>
          <button onClick={onClose} className="text-muted hover:text-fg">
            <X className="size-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
      </aside>
    </div>,
    document.body,
  );
}

/* ---------------- Toasts ---------------- */

type Toast = { id: number; text: string; tone: "ok" | "bad" };
const ToastCtx = createContext<(text: string, tone?: Toast["tone"]) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = (text: string, tone: Toast["tone"] = "ok") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === "bad" ? 6000 : 3000);
  };
  return (
    <ToastCtx.Provider value={push}>
      {children}
      {createPortal(
        <div className="fixed right-4 bottom-4 z-[60] flex flex-col gap-2">
          {toasts.map((t) => (
            <div
              key={t.id}
              className={clsx(
                "max-w-sm rounded-lg border px-4 py-3 text-sm shadow-xl backdrop-blur",
                t.tone === "ok" ? "border-ok/30 bg-panel/95 text-fg" : "border-bad/40 bg-panel/95 text-red-200",
              )}
            >
              {t.text}
            </div>
          ))}
        </div>,
        document.body,
      )}
    </ToastCtx.Provider>
  );
}
