import { useEffect, useRef, useState } from "react";
import { Eye, EyeOff, Mail, MessageCircle, Smartphone, Loader2 } from "lucide-react";

export const COUNTRIES: { dial: string; label: string }[] = [
  { dial: "+212", label: "🇲🇦 +212" }, { dial: "+213", label: "🇩🇿 +213" }, { dial: "+216", label: "🇹🇳 +216" },
  { dial: "+20", label: "🇪🇬 +20" }, { dial: "+966", label: "🇸🇦 +966" }, { dial: "+971", label: "🇦🇪 +971" },
  { dial: "+33", label: "🇫🇷 +33" }, { dial: "+34", label: "🇪🇸 +34" }, { dial: "+49", label: "🇩🇪 +49" },
  { dial: "+44", label: "🇬🇧 +44" }, { dial: "+1", label: "🇺🇸 +1" }, { dial: "+32", label: "🇧🇪 +32" },
  { dial: "+39", label: "🇮🇹 +39" }, { dial: "+31", label: "🇳🇱 +31" }, { dial: "+90", label: "🇹🇷 +90" },
];

const field = "h-11 rounded-md border border-input bg-background px-3 text-base text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** Build the E.164 number from the dial code and what the citizen typed (a leading 0 is dropped). */
export function toE164(dial: string, local: string): string {
  const digits = local.replace(/\D/g, "").replace(/^0+/, "");
  return digits ? `${dial}${digits}` : "";
}

/** Country code selector + number. Always left-to-right, in every language. */
export function PhoneField({ dial, local, onDial, onLocal, label, codeLabel, required, id }: {
  dial: string; local: string; onDial: (v: string) => void; onLocal: (v: string) => void;
  label: string; codeLabel: string; required?: boolean; id: string;
}) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-sm font-medium">{label}</label>
      <div dir="ltr" className="flex gap-2">
        <select aria-label={codeLabel} value={dial} onChange={e => onDial(e.target.value)} className={`${field} w-32 shrink-0`} data-testid={`${id}-dial`}>
          {COUNTRIES.map(c => <option key={c.dial} value={c.dial}>{c.label}</option>)}
        </select>
        <input id={id} dir="ltr" type="tel" inputMode="tel" autoComplete="tel-national" required={required}
          value={local} onChange={e => onLocal(e.target.value.replace(/[^\d\s]/g, ""))} placeholder="6 12 34 56 78"
          className={`${field} min-w-0 flex-1 text-left`} data-testid={`${id}-number`} />
      </div>
    </div>
  );
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Day / Month / Year dropdowns. Never <input type="date">: browsers translate its
 * placeholder and it breaks in RTL. Labels are fixed Latin digits, always LTR.
 */
export function DobSelect({ value, onChange, label }: { value: { d: string; m: string; y: string }; onChange: (v: { d: string; m: string; y: string }) => void; label: string }) {
  const thisYear = new Date().getFullYear();
  const years = Array.from({ length: thisYear - 1899 }, (_, i) => String(thisYear - i));
  const set = (k: "d" | "m" | "y") => (e: React.ChangeEvent<HTMLSelectElement>) => onChange({ ...value, [k]: e.target.value });
  return (
    <fieldset className="space-y-1">
      <legend className="text-sm font-medium">{label}</legend>
      <div dir="ltr" className="grid grid-cols-3 gap-2">
        <select aria-label="DD" value={value.d} onChange={set("d")} className={field} data-testid="dob-day" required>
          <option value="">DD</option>{Array.from({ length: 31 }, (_, i) => <option key={i} value={pad(i + 1)}>{pad(i + 1)}</option>)}
        </select>
        <select aria-label="MM" value={value.m} onChange={set("m")} className={field} data-testid="dob-month" required>
          <option value="">MM</option>{Array.from({ length: 12 }, (_, i) => <option key={i} value={pad(i + 1)}>{pad(i + 1)}</option>)}
        </select>
        <select aria-label="YYYY" value={value.y} onChange={set("y")} className={field} data-testid="dob-year" required>
          <option value="">YYYY</option>{years.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>
    </fieldset>
  );
}

export const dobToIso = (v: { d: string; m: string; y: string }) => (v.d && v.m && v.y ? `${v.y}-${v.m}-${v.d}` : "");

/** Six boxes, auto-advance, backspace goes back, paste fills all. */
export function OtpInput({ value, onChange, onComplete, autoFocus = true }: { value: string; onChange: (v: string) => void; onComplete?: (v: string) => void; autoFocus?: boolean }) {
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  useEffect(() => { if (autoFocus) refs.current[0]?.focus(); }, [autoFocus]);
  const digits = Array.from({ length: 6 }, (_, i) => value[i] ?? "");
  const commit = (next: string) => {
    onChange(next);
    if (next.length === 6) onComplete?.(next);
  };
  return (
    <div dir="ltr" className="flex justify-center gap-2" data-testid="otp-input">
      {digits.map((d, i) => (
        <input key={i} ref={el => { refs.current[i] = el; }} inputMode="numeric" autoComplete={i === 0 ? "one-time-code" : "off"}
          maxLength={1} value={d} aria-label={`${i + 1}/6`} data-testid={`otp-${i}`}
          className="h-12 w-11 rounded-md border border-input bg-background text-center text-xl font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onChange={e => {
            const c = e.target.value.replace(/\D/g, "").slice(-1);
            if (!c) return;
            const next = (value.slice(0, i) + c + value.slice(i + 1)).slice(0, 6);
            commit(next);
            refs.current[Math.min(i + 1, 5)]?.focus();
          }}
          onKeyDown={e => {
            if (e.key === "Backspace") {
              e.preventDefault();
              if (digits[i]) commit(value.slice(0, i) + value.slice(i + 1));
              else if (i > 0) { commit(value.slice(0, i - 1) + value.slice(i)); refs.current[i - 1]?.focus(); }
            }
          }}
          onPaste={e => {
            const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
            if (!pasted) return;
            e.preventDefault();
            commit(pasted);
            refs.current[Math.min(pasted.length, 5)]?.focus();
          }} />
      ))}
    </div>
  );
}

/** Seconds left until a new code may be requested; restart() begins a new 60s window. */
export function useCountdown(initial = 0) {
  const [left, setLeft] = useState(initial);
  useEffect(() => {
    if (left <= 0) return;
    const t = setTimeout(() => setLeft(l => l - 1), 1000);
    return () => clearTimeout(t);
  }, [left]);
  return [left, (s = 60) => setLeft(s)] as const;
}

/** Password input with a show/hide eye. The eye is part of the field, never a bare toggle. */
export function PasswordField({ id, label, value, onChange, autoComplete, required, minLength, showLabel, hideLabel }: {
  id: string; label: string; value: string; onChange: (v: string) => void; autoComplete: string;
  required?: boolean; minLength?: number; showLabel: string; hideLabel: string;
}) {
  const [shown, setShown] = useState(false);
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-sm font-medium">{label}</label>
      {/* The eye sits outside the input, after it in the flow: right in LTR (French), left in RTL (Arabic). */}
      <div className="flex items-center gap-2">
        <input id={id} dir="ltr" type={shown ? "text" : "password"} autoComplete={autoComplete} required={required} minLength={minLength}
          value={value} onChange={e => onChange(e.target.value)} data-testid={`${id}-input`}
          className={`${field} min-w-0 flex-1 text-left`} />
        <button type="button" onClick={() => setShown(s => !s)} aria-label={shown ? hideLabel : showLabel} aria-pressed={shown}
          data-testid={`${id}-eye`} title={shown ? hideLabel : showLabel}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {shown ? <EyeOff className="h-5 w-5" aria-hidden="true" /> : <Eye className="h-5 w-5" aria-hidden="true" />}
        </button>
      </div>
    </div>
  );
}

/** Four bars that fill as the password gets stronger. Text labels say which level it is. */
export function StrengthMeter({ score, labels, label }: { score: number; labels: [string, string, string, string]; label: string }) {
  const color = ["bg-destructive", "bg-orange-500", "bg-yellow-500", "bg-emerald-500"][Math.max(score - 1, 0)];
  return (
    <div className="space-y-1" aria-live="polite">
      <div className="flex gap-1" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={4} aria-valuenow={score}>
        {[0, 1, 2, 3].map(i => (
          <span key={i} className={`h-1.5 flex-1 rounded-full transition-colors duration-300 ${i < score ? color : "bg-muted"}`} />
        ))}
      </div>
      {score > 0 && <p className="text-xs text-muted-foreground">{label}: <b>{labels[score - 1]}</b></p>}
    </div>
  );
}

const CHANNEL_ICON = { sms: Smartphone, whatsapp: MessageCircle, email: Mail } as const;

/** Rounded channel buttons with an icon, a label and a loading state. */
export function ChannelButtons({ options, labels, busyChannel, disabled, onPick }: {
  options: Array<{ channel: "sms" | "whatsapp" | "email"; masked: string }>;
  labels: Record<"sms" | "whatsapp" | "email", string>;
  busyChannel: string | null; disabled: boolean; onPick: (c: "sms" | "whatsapp" | "email") => void;
}) {
  return (
    <div className="grid gap-2">
      {options.map(o => {
        const Icon = CHANNEL_ICON[o.channel];
        const loading = busyChannel === o.channel;
        return (
          <button key={o.channel} type="button" disabled={disabled} onClick={() => onPick(o.channel)} data-testid={`channel-${o.channel}`}
            className="flex h-14 w-full items-center gap-3 rounded-2xl border border-input bg-background px-4 text-start shadow-sm transition hover:border-primary hover:bg-primary/5 active:scale-[0.99] disabled:opacity-60">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Icon className="h-4 w-4" aria-hidden="true" />}
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-sm font-semibold">{labels[o.channel]}</span>
              <span dir="ltr" className="truncate text-xs text-muted-foreground">{o.masked}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
