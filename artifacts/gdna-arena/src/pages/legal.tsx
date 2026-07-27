import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useLang } from "@/contexts/LangContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FileCheck, Lock, Shield, Scale, Globe, AlertCircle, CheckCircle2 } from "lucide-react";

type Tab = "terms" | "privacy" | "cookies" | "gdpr";

const TABS: { key: Tab; icon: typeof FileCheck; labelKey: string }[] = [
  { key: "terms",   icon: FileCheck, labelKey: "legal_tab_terms" },
  { key: "privacy", icon: Lock,      labelKey: "legal_tab_privacy" },
  { key: "cookies", icon: Shield,    labelKey: "legal_tab_cookies" },
  { key: "gdpr",    icon: Globe,     labelKey: "legal_tab_gdpr" },
];

export default function Legal() {
  const { t } = useLang();
  const [tab, setTab] = useState<Tab>("terms");

  return (
    <div className="min-h-[calc(100vh-4rem)] px-4 py-10 max-w-4xl mx-auto space-y-8">

      {/* Header */}
      <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} className="text-center space-y-3">
        <div className="flex justify-center mb-3">
          <div className="w-14 h-14 rounded-xl bg-primary/10 border border-primary/30 flex items-center justify-center">
            <Scale className="w-7 h-7 text-primary" />
          </div>
        </div>
        <h1 className="text-4xl md:text-5xl font-black uppercase tracking-wider neon-text-glow">{t("legal_title")}</h1>
        <p className="text-sm text-muted-foreground max-w-xl mx-auto">{t("legal_sub")}</p>
        <div className="flex justify-center gap-2 flex-wrap">
          <Badge className="bg-green-400/10 text-green-400 border border-green-400/30 font-mono text-xs">✓ GDPR</Badge>
          <Badge className="bg-blue-400/10 text-blue-400 border border-blue-400/30 font-mono text-xs">✓ CCPA</Badge>
          <Badge className="bg-primary/10 text-primary border border-primary/30 font-mono text-xs">✓ ISO 27001</Badge>
        </div>
        <p className="text-xs text-muted-foreground font-mono">{t("legal_updated")}: 2026-01-01 · v3.2.1</p>
      </motion.div>

      {/* Tab Navigation */}
      <div className="flex flex-wrap gap-2 justify-center">
        {TABS.map((tb) => (
          <button
            key={tb.key}
            onClick={() => setTab(tb.key)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold uppercase tracking-wider border transition-all ${
              tab === tb.key
                ? "bg-primary/20 text-primary border-primary/60"
                : "bg-card/30 text-muted-foreground border-border/50 hover:border-primary/30 hover:text-primary"
            }`}
          >
            <tb.icon className="w-4 h-4" />
            {t(tb.labelKey)}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <AnimatePresence mode="wait">
        <motion.div
          key={tab}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.2 }}
        >
          {tab === "terms" && <TermsContent t={t} />}
          {tab === "privacy" && <PrivacyContent t={t} />}
          {tab === "cookies" && <CookiesContent t={t} />}
          {tab === "gdpr" && <GdprContent t={t} />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

// ── Terms of Service ─────────────────────────────────────────────────────────
function TermsContent({ t }: { t: (k: string) => string }) {
  const sections = [
    { title: t("terms_s1_title"), body: t("terms_s1_body") },
    { title: t("terms_s2_title"), body: t("terms_s2_body") },
    { title: t("terms_s3_title"), body: t("terms_s3_body") },
    { title: t("terms_s4_title"), body: t("terms_s4_body") },
    { title: t("terms_s5_title"), body: t("terms_s5_body") },
  ];
  return (
    <Card className="bg-card/30 border-primary/20">
      <CardContent className="p-6 md:p-8 space-y-6">
        <div className="flex items-center gap-3 pb-4 border-b border-border/50">
          <FileCheck className="w-6 h-6 text-primary" />
          <h2 className="text-xl font-black uppercase tracking-wider">{t("legal_tab_terms")}</h2>
        </div>
        {sections.map((s, i) => (
          <div key={i} className="space-y-2">
            <h3 className="font-bold text-primary uppercase tracking-wider text-sm">
              {i + 1}. {s.title}
            </h3>
            <p className="text-sm text-foreground/80 leading-relaxed">{s.body}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

// ── Privacy Policy ──────────────────────────────────────────────────────────
function PrivacyContent({ t }: { t: (k: string) => string }) {
  const items = [
    { icon: CheckCircle2, label: t("privacy_1") },
    { icon: CheckCircle2, label: t("privacy_2") },
    { icon: CheckCircle2, label: t("privacy_3") },
    { icon: CheckCircle2, label: t("privacy_4") },
    { icon: AlertCircle,  label: t("privacy_5") },
    { icon: CheckCircle2, label: t("privacy_6") },
  ];
  return (
    <Card className="bg-card/30 border-primary/20">
      <CardContent className="p-6 md:p-8 space-y-6">
        <div className="flex items-center gap-3 pb-4 border-b border-border/50">
          <Lock className="w-6 h-6 text-primary" />
          <h2 className="text-xl font-black uppercase tracking-wider">{t("legal_tab_privacy")}</h2>
        </div>
        <p className="text-sm text-foreground/80 leading-relaxed">{t("privacy_intro")}</p>
        <div className="space-y-3">
          {items.map((item, i) => (
            <div key={i} className="flex items-start gap-3 p-3 rounded-lg bg-background/40 border border-border/30">
              <item.icon className={`w-4 h-4 mt-0.5 shrink-0 ${item.icon === AlertCircle ? "text-yellow-400" : "text-green-400"}`} />
              <p className="text-sm text-foreground/80">{item.label}</p>
            </div>
          ))}
        </div>
        <div className="p-4 rounded-xl bg-primary/5 border border-primary/20">
          <p className="text-xs text-muted-foreground font-mono">{t("privacy_contact")}</p>
          <p className="text-xs text-primary font-mono mt-1">legal@gdna-arena.com</p>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Cookie Policy ────────────────────────────────────────────────────────────
function CookiesContent({ t }: { t: (k: string) => string }) {
  const types = [
    { name: t("cookie_1_name"), purpose: t("cookie_1_purpose"), required: true },
    { name: t("cookie_2_name"), purpose: t("cookie_2_purpose"), required: true },
    { name: t("cookie_3_name"), purpose: t("cookie_3_purpose"), required: false },
    { name: t("cookie_4_name"), purpose: t("cookie_4_purpose"), required: false },
  ];
  return (
    <Card className="bg-card/30 border-primary/20">
      <CardContent className="p-6 md:p-8 space-y-6">
        <div className="flex items-center gap-3 pb-4 border-b border-border/50">
          <Shield className="w-6 h-6 text-primary" />
          <h2 className="text-xl font-black uppercase tracking-wider">{t("legal_tab_cookies")}</h2>
        </div>
        <p className="text-sm text-foreground/80 leading-relaxed">{t("cookies_intro")}</p>
        <div className="space-y-3">
          {types.map((c, i) => (
            <div key={i} className="flex items-start justify-between gap-3 p-4 rounded-lg bg-background/40 border border-border/30">
              <div>
                <p className="font-bold text-sm">{c.name}</p>
                <p className="text-xs text-muted-foreground mt-1">{c.purpose}</p>
              </div>
              <Badge className={c.required
                ? "bg-red-400/10 text-red-400 border border-red-400/30 text-xs shrink-0"
                : "bg-muted/30 text-muted-foreground border border-border/50 text-xs shrink-0"
              }>
                {c.required ? t("cookie_required") : t("cookie_optional")}
              </Badge>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ── GDPR Rights ──────────────────────────────────────────────────────────────
function GdprContent({ t }: { t: (k: string) => string }) {
  const rights = [
    { right: t("gdpr_r1"), detail: t("gdpr_r1d") },
    { right: t("gdpr_r2"), detail: t("gdpr_r2d") },
    { right: t("gdpr_r3"), detail: t("gdpr_r3d") },
    { right: t("gdpr_r4"), detail: t("gdpr_r4d") },
    { right: t("gdpr_r5"), detail: t("gdpr_r5d") },
    { right: t("gdpr_r6"), detail: t("gdpr_r6d") },
  ];
  return (
    <Card className="bg-card/30 border-green-400/20">
      <CardContent className="p-6 md:p-8 space-y-6">
        <div className="flex items-center gap-3 pb-4 border-b border-border/50">
          <Globe className="w-6 h-6 text-green-400" />
          <h2 className="text-xl font-black uppercase tracking-wider">{t("legal_tab_gdpr")}</h2>
          <Badge className="bg-green-400/10 text-green-400 border border-green-400/30 text-xs ml-auto">
            EU 2016/679
          </Badge>
        </div>
        <p className="text-sm text-foreground/80">{t("gdpr_intro")}</p>
        <div className="grid md:grid-cols-2 gap-3">
          {rights.map((r, i) => (
            <div key={i} className="p-4 rounded-xl bg-background/40 border border-green-400/10 space-y-1">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-green-400 shrink-0" />
                <p className="font-bold text-sm text-green-400">{r.right}</p>
              </div>
              <p className="text-xs text-muted-foreground pl-6">{r.detail}</p>
            </div>
          ))}
        </div>
        <div className="p-4 rounded-xl bg-green-400/5 border border-green-400/20 flex items-start gap-3">
          <AlertCircle className="w-4 h-4 text-green-400 mt-0.5 shrink-0" />
          <p className="text-xs text-muted-foreground">{t("gdpr_dpo")}</p>
        </div>
      </CardContent>
    </Card>
  );
}
