/**
 * SolidarityRelay — replaces the read-only Actus tab.
 * Shows: citizen solidarity score + status, empire/community initiative cards
 * with progress/support, and a creation flow. GDNA language + GDNA-DS tokens.
 *
 * Fix #1  — status is "open" | "completed" | "cancelled" (not "active").
 * Fix #3  — accepts activeRoomId + onClearRoom to scope feed to a community
 *            and display a "← All empire" breadcrumb.
 * Fix #4  — domains aligned to backend: future|justice|culture|education|
 *            health|environment|technology|community. Labels in i18n.
 */
import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Shield, Plus, X, CheckCircle2, XCircle, Users,
  Loader2, HandHeart, ChevronDown, ArrowLeft,
} from "lucide-react";
import { Button } from "@workspace/gdna-ds/components/ui/button";
import { Input } from "@workspace/gdna-ds/components/ui/input";
import { Badge } from "@workspace/gdna-ds/components/ui/badge";
import { Progress } from "@workspace/gdna-ds/components/ui/progress";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@workspace/gdna-ds/components/ui/select";
import Avatar from "../social/Avatar";
import { GOLD, timeAgo, api } from "../social/social-i18n";
import { useConnectivity } from "@/contexts/ConnectivityContext";

// ── Backend-authoritative domain list ─────────────────────────────────────────
const RELAY_DOMAINS = [
  "future", "justice", "culture", "education",
  "health", "environment", "technology", "community",
] as const;
export type RelayDomain = typeof RELAY_DOMAINS[number];

// Domain icons (no emoji removed — display only, never stored)
const RELAY_DOMAIN_ICONS: Record<RelayDomain, string> = {
  future:      "🔭",
  justice:     "⚖️",
  culture:     "🎭",
  education:   "📚",
  health:      "🩺",
  environment: "🌿",
  technology:  "💡",
  community:   "🤝",
};

// Domain i18n keys (resolved by caller's st object)
const RELAY_DOMAIN_KEYS: Record<RelayDomain, string> = {
  future:      "relay_domain_future",
  justice:     "relay_domain_justice",
  culture:     "relay_domain_culture",
  education:   "relay_domain_education",
  health:      "relay_domain_health",
  environment: "relay_domain_environment",
  technology:  "relay_domain_technology",
  community:   "relay_domain_community",
};

// ── Types ─────────────────────────────────────────────────────────────────────
interface SolidarityProfile {
  score: number;
  initiativesCompleted: number;
  supportsCompleted: number;
  status: string | null;
  statusVisible: boolean;
}

interface Initiative {
  id: number;
  creatorId: number;
  creatorUsername: string;
  title: string;
  body: string;
  domain: string;
  roomId: number | null;
  roomName: string | null;
  targetSupport: number;
  supportCount: number;
  supportedByMe: boolean;
  /** Fix #1: backend sends "open" | "completed" | "cancelled" */
  status: "open" | "completed" | "cancelled" | string;
  createdAt: string;
  completedAt: string | null;
}

const SOLIDARITY_STATUSES = [
  { value: "available", label: "Available", color: "#22c55e" },
  { value: "listening", label: "Listening",  color: "#3b82f6" },
  { value: "seeking",   label: "Seeking",    color: GOLD },
  { value: "focused",   label: "Focused",    color: "#a78bfa" },
  { value: "offline",   label: "Offline",    color: "#6b7280" },
] as const;

// ── i18n additions exported for social-i18n merge ─────────────────────────────
const SOLIDARITY_ST: Record<string, Record<string, string>> = {
  en: {
    relay_title: "Solidarity Relay",
    relay_score: "Solidarity Score",
    relay_completed: "Completed",
    relay_initiatives: "Initiatives",
    relay_supports: "Supports",
    relay_status_label: "Your stance",
    relay_status_available: "Available",
    relay_status_listening: "Listening",
    relay_status_seeking: "Seeking",
    relay_status_focused: "Focused",
    relay_status_offline: "Offline",
    relay_status_visible: "Visible to other citizens",
    relay_empty: "No initiatives yet — be the first to rally the empire.",
    relay_create: "Stand with the empire",
    relay_title_placeholder: "Initiative title…",
    relay_body_placeholder: "Describe the purpose and what is needed…",
    relay_target_placeholder: "Target supporters (e.g. 50)",
    relay_domain_label: "Domain",
    relay_room_label: "Community (optional)",
    relay_submit: "Launch initiative",
    relay_submitting: "Launching…",
    relay_support: "Stand with it",
    relay_withdraw: "Withdraw",
    relay_cancel_initiative: "Cancel initiative",
    relay_completed_label: "Accomplished",
    relay_cancelled_label: "Cancelled",
    relay_progress: "of target",
    relay_validation_title: "Title is required",
    relay_validation_body: "Body is required",
    relay_validation_target: "Target must be a whole number from 3 to 1000",
    relay_submit_failed: "The initiative could not be launched. Please try again.",
    relay_all_empire: "All empire",
    relay_scoped_to: "Assembly scope",
    // Fix #4 — domain labels
    relay_domain_future:      "Future",
    relay_domain_justice:     "Justice",
    relay_domain_culture:     "Culture",
    relay_domain_education:   "Education",
    relay_domain_health:      "Health",
    relay_domain_environment: "Environment",
    relay_domain_technology:  "Technology",
    relay_domain_community:   "Community",
  },
  ar: {
    relay_title: "شبكة التضامن",
    relay_score: "نقاط التضامن",
    relay_completed: "مكتمل",
    relay_initiatives: "المبادرات",
    relay_supports: "الدعم",
    relay_status_label: "موقفك",
    relay_status_available: "متاح",
    relay_status_listening: "مستمع",
    relay_status_seeking: "أبحث عن الدعم",
    relay_status_focused: "مركّز",
    relay_status_offline: "غير متصل",
    relay_status_visible: "مرئي للمواطنين الآخرين",
    relay_empty: "لا مبادرات بعد — كن أول من يحشد الإمبراطورية.",
    relay_create: "تضامن مع الإمبراطورية",
    relay_title_placeholder: "عنوان المبادرة…",
    relay_body_placeholder: "صف الهدف وما هو مطلوب…",
    relay_target_placeholder: "المستهدف من الداعمين (مثل 50)",
    relay_domain_label: "المجال",
    relay_room_label: "المجتمع (اختياري)",
    relay_submit: "أطلق المبادرة",
    relay_submitting: "جارٍ الإطلاق…",
    relay_support: "تضامن معها",
    relay_withdraw: "تراجع",
    relay_cancel_initiative: "إلغاء المبادرة",
    relay_completed_label: "تمّ إنجازه",
    relay_cancelled_label: "ملغى",
    relay_progress: "من الهدف",
    relay_validation_title: "العنوان مطلوب",
    relay_validation_body: "الوصف مطلوب",
    relay_validation_target: "الهدف يجب أن يكون عدداً صحيحاً من 3 إلى 1000",
    relay_submit_failed: "تعذر إطلاق المبادرة. حاول مرة أخرى.",
    relay_all_empire: "كل الإمبراطورية",
    relay_scoped_to: "نطاق الجمعية",
    // Fix #4 — domain labels
    relay_domain_future:      "المستقبل",
    relay_domain_justice:     "العدالة",
    relay_domain_culture:     "الثقافة",
    relay_domain_education:   "التعليم",
    relay_domain_health:      "الصحة",
    relay_domain_environment: "البيئة",
    relay_domain_technology:  "التكنولوجيا",
    relay_domain_community:   "المجتمع",
  },
};

// ── StatusSelector ─────────────────────────────────────────────────────────────
function StatusSelector({
  profile, st, onUpdate,
}: {
  profile: SolidarityProfile | null;
  st: Record<string, string>;
  onUpdate: () => void;
}) {
  const { isOnline } = useConnectivity();
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);

  const current = SOLIDARITY_STATUSES.find(s => s.value === profile?.status)
    ?? SOLIDARITY_STATUSES[4];

  async function changeStatus(value: string) {
    if (!isOnline) return;
    setSaving(true);
    setOpen(false);
    await fetch(api("/api/solidarity/status"), {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: value, statusVisible: profile?.statusVisible ?? true }),
      credentials: "include",
    }).catch(() => {});
    setSaving(false);
    onUpdate();
  }

  async function toggleVisible() {
    if (!isOnline) return;
    if (!profile) return;
    setSaving(true);
    await fetch(api("/api/solidarity/status"), {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: profile.status, statusVisible: !profile.statusVisible }),
      credentials: "include",
    }).catch(() => {});
    setSaving(false);
    onUpdate();
  }

  return (
    <div className="flex flex-col gap-2 pb-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {st.relay_status_label ?? "Your stance"}
      </p>
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative">
          <button
            onClick={() => setOpen(v => !v)}
            className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm font-bold text-card-foreground min-h-[44px]"
            disabled={saving || !isOnline}
            aria-haspopup="listbox"
            aria-expanded={open}
          >
            {saving
              ? <Loader2 size={14} className="animate-spin" />
              : <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: current.color }} />
            }
            {st[`relay_status_${current.value}`] ?? current.label}
            <ChevronDown size={13} className="text-muted-foreground" />
          </button>
          <AnimatePresence>
            {open && (
              <motion.div
                role="listbox"
                initial={{ opacity: 0, y: -6, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -6, scale: 0.96 }}
                transition={{ duration: 0.12 }}
                className="absolute top-full mt-1 left-0 z-50 min-w-[160px] rounded-lg border border-border bg-popover shadow-lg overflow-hidden"
              >
                {SOLIDARITY_STATUSES.map(s => (
                  <button
                    key={s.value}
                    role="option"
                    aria-selected={profile?.status === s.value}
                    onClick={() => changeStatus(s.value)}
                    className="flex w-full items-center gap-2 px-3 py-2.5 text-sm font-semibold text-popover-foreground hover:bg-accent"
                  >
                    <span className="h-2 w-2 rounded-full shrink-0" style={{ background: s.color }} />
                    {st[`relay_status_${s.value}`] ?? s.label}
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        <button
          onClick={toggleVisible}
          className="flex items-center gap-1.5 text-xs text-muted-foreground min-h-[44px] px-2"
            disabled={saving || !profile || !isOnline}
        >
          <span
            className="inline-block h-3.5 w-3.5 rounded border border-border transition-colors"
            style={{ background: profile?.statusVisible ? GOLD : "transparent" }}
          />
          {st.relay_status_visible ?? "Visible to others"}
        </button>
      </div>
    </div>
  );
}

// ── InitiativeCard ─────────────────────────────────────────────────────────────
function InitiativeCard({
  initiative, currentUserId, st, onRefresh,
}: {
  initiative: Initiative;
  currentUserId: number;
  st: Record<string, string>;
  onRefresh: () => void;
}) {
  const { isOnline } = useConnectivity();
  const [busy, setBusy] = useState(false);
  const pct = Math.min(100, Math.round(
    (initiative.supportCount / Math.max(1, initiative.targetSupport)) * 100
  ));
  const isMine = initiative.creatorId === currentUserId;
  // Fix #1: backend sends "open" not "active"
  const isOpen = initiative.status === "open";

  const domainLabel = st[RELAY_DOMAIN_KEYS[initiative.domain as RelayDomain]]
    ?? initiative.domain;
  const domainIcon  = RELAY_DOMAIN_ICONS[initiative.domain as RelayDomain] ?? "🌍";

  async function toggleSupport() {
    if (!isOnline) return;
    if (busy) return;
    setBusy(true);
    const method = initiative.supportedByMe ? "DELETE" : "POST";
    await fetch(api(`/api/solidarity/initiatives/${initiative.id}/support`), {
      method, credentials: "include",
    }).catch(() => {});
    setBusy(false);
    onRefresh();
  }

  async function cancelInitiative() {
    if (!isOnline) return;
    if (!window.confirm(st.relay_cancel_confirm ?? "Cancel this initiative? This cannot be undone.")) return;
    setBusy(true);
    await fetch(api(`/api/solidarity/initiatives/${initiative.id}`), {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "cancelled" }), credentials: "include",
    }).catch(() => {});
    setBusy(false);
    onRefresh();
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-xl border border-border bg-card p-4 flex flex-col gap-3"
      data-testid={`initiative-card-${initiative.id}`}
    >
      {/* Header row */}
      <div className="flex items-start gap-3">
        <Avatar name={initiative.creatorUsername} size={36} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-bold text-card-foreground truncate">{initiative.creatorUsername}</p>
            {initiative.roomName && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 shrink-0">
                <Users size={9} className="mr-1" />{initiative.roomName}
              </Badge>
            )}
            <span className="text-[11px] text-muted-foreground ml-auto shrink-0">
              {domainIcon} {domainLabel}
            </span>
          </div>
          <p className="text-[10.5px] text-muted-foreground mt-0.5">{timeAgo(initiative.createdAt, st)}</p>
        </div>
        {/* Status badge — only for non-open */}
        {initiative.status === "completed" && (
          <Badge variant="secondary" className="shrink-0 gap-1 text-[10px]">
            <CheckCircle2 size={10} style={{ color: "#22c55e" }} />
            {st.relay_completed_label ?? "Accomplished"}
          </Badge>
        )}
        {initiative.status === "cancelled" && (
          <Badge variant="outline" className="shrink-0 gap-1 text-[10px] text-muted-foreground">
            <XCircle size={10} />
            {st.relay_cancelled_label ?? "Cancelled"}
          </Badge>
        )}
      </div>

      {/* Title + body */}
      <div>
        <p className="text-sm font-bold text-card-foreground leading-snug">{initiative.title}</p>
        <p className="text-sm text-muted-foreground mt-1 leading-relaxed">{initiative.body}</p>
      </div>

      {/* Progress */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between text-[11px]">
          <span className="font-bold text-card-foreground">
            {initiative.supportCount} / {initiative.targetSupport} {st.relay_progress ?? "of target"}
          </span>
          <span className="text-muted-foreground">{pct}%</span>
        </div>
        <Progress value={pct} className="h-1.5" />
      </div>

      {/* Actions — only for open initiatives (Fix #1) */}
      {isOpen && (
        <div className="flex gap-2 flex-wrap">
          {!isMine && (
            <Button
              size="sm"
              variant={initiative.supportedByMe ? "secondary" : "default"}
              className="h-10 flex-1 gap-1.5 text-xs font-bold"
              disabled={busy || !isOnline}
              onClick={toggleSupport}
              data-testid={`support-btn-${initiative.id}`}
            >
              {busy
                ? <Loader2 size={13} className="animate-spin" />
                : <HandHeart size={13} />
              }
              {initiative.supportedByMe
                ? (st.relay_withdraw ?? "Withdraw")
                : (st.relay_support ?? "Stand with it")}
            </Button>
          )}
          {isMine && (
            <Button
              size="sm"
              variant="outline"
              className="h-10 px-3 text-xs text-destructive border-destructive/30 hover:bg-destructive/10"
              disabled={busy || !isOnline}
              onClick={cancelInitiative}
            >
              <XCircle size={12} className="mr-1" />
              {st.relay_cancel_initiative ?? "Cancel"}
            </Button>
          )}
        </div>
      )}
    </motion.div>
  );
}

// ── CreateForm ─────────────────────────────────────────────────────────────────
function CreateForm({
  st, onCreated, onClose, scopedRoomId,
}: {
  st: Record<string, string>;
  onCreated: () => void | Promise<void>;
  onClose: () => void;
  scopedRoomId?: number | null;
}) {
  const { isOnline } = useConnectivity();
  // Fix #4: first backend domain as default
  const [title, setTitle]       = useState("");
  const [body, setBody]         = useState("");
  const [domain, setDomain]     = useState<RelayDomain>("community");
  const [target, setTarget]     = useState("10");
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors]     = useState<Record<string, string>>({});

  function validate() {
    const e: Record<string, string> = {};
    if (!title.trim()) e.title  = st.relay_validation_title  ?? "Title is required";
    if (!body.trim())  e.body   = st.relay_validation_body   ?? "Body is required";
    const parsedTarget = Number(target);
    if (!Number.isInteger(parsedTarget) || parsedTarget < 3 || parsedTarget > 1000) {
      e.target = st.relay_validation_target ?? "Target must be a whole number from 3 to 1000";
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function submit() {
    if (!isOnline) return;
    if (!validate() || submitting) return;
    setSubmitting(true);
    try {
      const payload: Record<string, unknown> = {
        title: title.trim(),
        body:  body.trim(),
        domain,
        targetSupport: Number(target),
      };
      if (scopedRoomId) payload.roomId = scopedRoomId;
      const r = await fetch(api("/api/solidarity/initiatives"), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload), credentials: "include",
      });
      if (r.ok) {
        onClose();
        await onCreated();
      } else {
        const responseBody = await r.json().catch(() => ({} as { error?: string }));
        setErrors(current => ({
          ...current,
          form: responseBody.error ?? st.relay_submit_failed ?? "The initiative could not be launched. Please try again.",
        }));
      }
    } catch {
      setErrors(current => ({
        ...current,
        form: st.relay_submit_failed ?? "The initiative could not be launched. Please try again.",
      }));
    } finally { setSubmitting(false); }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 10 }}
      className="mx-3 mb-3 rounded-xl border border-border bg-card p-4 flex flex-col gap-3"
    >
      <div className="flex items-center justify-between">
        <p className="text-sm font-bold text-card-foreground flex items-center gap-2">
          <Shield size={14} style={{ color: GOLD }} />
          {st.relay_create ?? "Stand with the empire"}
        </p>
        <button onClick={onClose} className="text-muted-foreground p-1 hover:text-foreground" aria-label="Close">
          <X size={16} />
        </button>
      </div>

      <div className="flex flex-col gap-1">
        <Input
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder={st.relay_title_placeholder ?? "Initiative title…"}
          dir="auto"
          className="h-10 text-sm"
          data-testid="input-initiative-title"
        />
        {errors.title && <p className="text-[11px] text-destructive">{errors.title}</p>}
      </div>

      <div className="flex flex-col gap-1">
        <textarea
          value={body}
          onChange={e => setBody(e.target.value)}
          placeholder={st.relay_body_placeholder ?? "Describe the purpose…"}
          dir="auto"
          rows={3}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-none"
          data-testid="input-initiative-body"
        />
        {errors.body && <p className="text-[11px] text-destructive">{errors.body}</p>}
      </div>

      <div className="flex gap-2">
        {/* Fix #4: domain selector uses backend-authoritative values + i18n labels */}
        <Select value={domain} onValueChange={v => setDomain(v as RelayDomain)}>
          <SelectTrigger className="h-10 flex-1 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {RELAY_DOMAINS.map(d => (
              <SelectItem key={d} value={d}>
                {RELAY_DOMAIN_ICONS[d]}{" "}
                {st[RELAY_DOMAIN_KEYS[d]] ?? d}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex flex-col gap-1 w-32">
          <Input
            type="number"
            min={3}
            max={1000}
            step={1}
            value={target}
            onChange={e => setTarget(e.target.value)}
            placeholder={st.relay_target_placeholder ?? "Target"}
            className="h-10 text-sm"
            data-testid="input-initiative-target"
          />
          {errors.target && <p className="text-[10px] text-destructive">{errors.target}</p>}
        </div>
      </div>

      <Button
        className="h-11 w-full gap-2 font-bold"
        onClick={submit}
        disabled={submitting || !isOnline}
        data-testid="button-launch-initiative"
      >
        {submitting
          ? <><Loader2 size={14} className="animate-spin" />{st.relay_submitting ?? "Launching…"}</>
          : <><HandHeart size={14} />{st.relay_submit ?? "Launch initiative"}</>
        }
      </Button>
      {errors.form && (
        <p role="alert" className="text-[11px] text-destructive text-center">
          {errors.form}
        </p>
      )}
    </motion.div>
  );
}

// ── SolidarityRelay (main export) ─────────────────────────────────────────────
interface Props {
  st: Record<string, string>;
  currentUserId: number;
  lang?: string;
  /** Fix #3: non-null → community-scoped view; null → empire-wide */
  activeRoomId?: number | null;
  /** Fix #3: community name for breadcrumb */
  activeRoomName?: string | null;
  /** Fix #3: callback to clear community scope → back to empire-wide */
  onClearRoom?: () => void;
}

export default function SolidarityRelay({
  st, currentUserId, lang = "en", activeRoomId, activeRoomName, onClearRoom,
}: Props) {
  const { isOnline } = useConnectivity();
  const [profile, setProfile]       = useState<SolidarityProfile | null>(null);
  const [initiatives, setInitiatives] = useState<Initiative[]>([]);
  const [loading, setLoading]       = useState(true);
  const [failed, setFailed]         = useState(false);
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      const params = activeRoomId ? `?roomId=${activeRoomId}` : "";
      const r = await fetch(api(`/api/solidarity/initiatives${params}`), { credentials: "include" });
      if (!r.ok) throw new Error("non-ok");
      const j = await r.json();
      setInitiatives(j.initiatives ?? []);
      if (j.profile) setProfile(j.profile);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [activeRoomId]);

  useEffect(() => {
    setLoading(true);
    setInitiatives([]);
    load();
  }, [load]);

  const handleCreated = useCallback(async () => {
    setShowCreate(false);
    await load();
  }, [load]);

  // Merged i18n: caller-supplied st takes priority over SOLIDARITY_ST defaults
  const merged: Record<string, string> = {
    ...(SOLIDARITY_ST[lang] ?? SOLIDARITY_ST.en),
    ...st,
  };

  const isScoped = !!activeRoomId;

  return (
    <div className="flex flex-col flex-1 overflow-hidden">

      {/* ── Fix #3: Community-scope breadcrumb / "← All empire" ── */}
      {isScoped && (
        <div
          className="flex items-center gap-2 px-3 py-2 border-b border-border/40"
          style={{ background: `${GOLD}08` }}
        >
          <button
            onClick={onClearRoom}
            className="flex items-center gap-1.5 text-xs font-bold min-h-[44px] px-2"
            style={{ color: GOLD }}
            aria-label={merged.relay_all_empire ?? "All empire"}
          >
            <ArrowLeft size={13} />
            {merged.relay_all_empire ?? "All empire"}
          </button>
          <span className="text-xs text-muted-foreground">·</span>
          <span className="text-xs font-semibold text-muted-foreground truncate">
            {activeRoomName ?? merged.relay_scoped_to ?? "Assembly scope"}
          </span>
        </div>
      )}

      {/* ── Profile strip ── */}
      {profile && (
        <div className="border-b border-border/40 px-4 py-3 flex flex-col gap-3">
          <div className="flex items-center gap-4">
            <div className="flex flex-col items-center px-3 py-2 rounded-lg bg-card border border-border min-w-[70px]">
              <Shield size={16} style={{ color: GOLD }} className="mb-0.5" />
              <p className="text-base font-black" style={{ color: GOLD }}>{profile.score}</p>
              <p className="text-[9px] text-muted-foreground uppercase tracking-wide">
                {merged.relay_score ?? "Score"}
              </p>
            </div>
            <div className="flex gap-5 flex-1">
              <div className="flex flex-col items-center">
                <p className="text-sm font-bold text-card-foreground">{profile.initiativesCompleted}</p>
                <p className="text-[10px] text-muted-foreground">{merged.relay_initiatives ?? "Initiatives"}</p>
              </div>
              <div className="flex flex-col items-center">
                <p className="text-sm font-bold text-card-foreground">{profile.supportsCompleted}</p>
                <p className="text-[10px] text-muted-foreground">{merged.relay_supports ?? "Supports"}</p>
              </div>
            </div>
          </div>
          <StatusSelector profile={profile} st={merged} onUpdate={load} />
        </div>
      )}

      {/* ── Create CTA ── */}
      <div className="px-3 pt-3 shrink-0">
        <button
          onClick={() => isOnline && setShowCreate(v => !v)}
          disabled={!isOnline}
          className="w-full flex items-center gap-2.5 rounded-xl border px-4 py-3 text-sm font-bold min-h-[44px] transition-colors"
          style={{ borderColor: `${GOLD}30`, background: `${GOLD}0a`, color: GOLD }}
          data-testid="button-show-create"
          aria-expanded={showCreate}
        >
          <Plus size={16} />
          {merged.relay_create ?? "Stand with the empire"}
        </button>
      </div>

      {/* ── Create form ── */}
      <AnimatePresence>
        {showCreate && (
          <CreateForm
            st={merged}
            onCreated={handleCreated}
            onClose={() => setShowCreate(false)}
            scopedRoomId={activeRoomId}
          />
        )}
      </AnimatePresence>

      {/* ── Feed ── */}
      <div className="flex-1 overflow-y-auto px-3 pb-4 pt-3 flex flex-col gap-3">
        {loading && (
          <>
            {[1, 2, 3].map(i => (
              <div key={i} className="h-36 rounded-xl bg-card/50 border border-border animate-pulse" />
            ))}
          </>
        )}
        {!loading && failed && (
          <div className="flex flex-col items-center gap-3 py-12">
            <p className="text-sm text-muted-foreground">Could not load initiatives</p>
            <Button variant="outline" size="sm" onClick={load}>Retry</Button>
          </div>
        )}
        {!loading && !failed && initiatives.length === 0 && (
          <div className="flex flex-col items-center gap-3 py-12 text-center">
            <HandHeart size={32} className="text-muted-foreground opacity-30" />
            <p className="text-sm text-muted-foreground">
              {merged.relay_empty ?? "No initiatives yet — be the first to rally the empire."}
            </p>
          </div>
        )}
        {initiatives.map(initiative => (
          <InitiativeCard
            key={initiative.id}
            initiative={initiative}
            currentUserId={currentUserId}
            st={merged}
            onRefresh={load}
          />
        ))}
      </div>
    </div>
  );
}
