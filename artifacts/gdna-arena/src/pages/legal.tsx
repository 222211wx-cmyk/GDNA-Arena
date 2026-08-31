import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useLegal, COUNTRIES, type CountryProfile } from "@/contexts/LegalContext";
import { useLang } from "@/contexts/LangContext";

type Tab = "country" | "terms" | "privacy" | "cookies" | "rights";

const COIN_DISCLAIMER = {
  en: "⚠️ Arena Qaisypro coins are virtual in-platform credits with no real-world monetary value. They cannot be exchanged for fiat currency, cryptocurrency, or any real-world asset. Coin balances do not constitute financial instruments under any jurisdiction.",
  ar: "⚠️ كوينز Arena Qaisypro هي رصيد افتراضي داخل المنصة ليس له أي قيمة نقدية حقيقية. لا يمكن تحويلها إلى عملات ورقية أو رقمية أو أي أصول حقيقية. أرصدة الكوينز لا تُشكّل أدوات مالية بأي قانون.",
  fr: "⚠️ Les coins Arena Qaisypro sont des crédits virtuels sans valeur monétaire réelle. Ils ne peuvent pas être échangés contre des devises ou des crypto-monnaies. Les soldes ne constituent pas des instruments financiers.",
  es: "⚠️ Las monedas de Arena Qaisypro son créditos virtuales sin valor monetario real. No se pueden canjear por moneda fiduciaria ni criptomonedas. Los saldos no constituyen instrumentos financieros.",
  de: "⚠️ Arena Qaisypro Coins sind virtuelle Guthaben ohne realen Geldwert. Sie können nicht gegen Fiat-Währungen oder Kryptowährungen eingetauscht werden.",
};

export default function LegalPage() {
  const { country, setCountry, consent, setConsent, ageVerified, setAgeVerified } = useLegal();
  const { lang } = useLang();
  const isRTL = lang === "ar";
  const [tab, setTab] = useState<Tab>("country");
  const [search, setSearch] = useState("");

  const filtered = COUNTRIES.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.code.toLowerCase().includes(search.toLowerCase())
  );

  const disclaimer = COIN_DISCLAIMER[lang as keyof typeof COIN_DISCLAIMER] ?? COIN_DISCLAIMER.en;

  const tabLabels: Record<Tab, string> = {
    country: lang === "ar" ? "🌍 بلدك" : lang === "fr" ? "🌍 Votre pays" : lang === "es" ? "🌍 Tu país" : lang === "de" ? "🌍 Ihr Land" : "🌍 Your Country",
    terms:   lang === "ar" ? "📋 الشروط" : lang === "fr" ? "📋 CGU" : lang === "es" ? "📋 Términos" : lang === "de" ? "📋 AGB" : "📋 Terms",
    privacy: lang === "ar" ? "🔒 الخصوصية" : lang === "fr" ? "🔒 Confidentialité" : lang === "es" ? "🔒 Privacidad" : lang === "de" ? "🔒 Datenschutz" : "🔒 Privacy",
    cookies: lang === "ar" ? "🍪 الكوكيز" : "🍪 Cookies",
    rights:  lang === "ar" ? "⚖️ حقوقك" : lang === "fr" ? "⚖️ Vos droits" : lang === "es" ? "⚖️ Tus derechos" : lang === "de" ? "⚖️ Ihre Rechte" : "⚖️ Your Rights",
  };

  return (
    <div dir={isRTL ? "rtl" : "ltr"} className="min-h-screen bg-background text-foreground pt-16 pb-12">

      {/* Header */}
      <div className="border-b border-yellow-500/20 px-6 py-8 text-center">
        <div className="text-yellow-500 text-xs tracking-[0.4em] mb-2">⚖️ LEGAL CENTER</div>
        <h1 className="text-4xl font-black text-foreground">
          {lang === "ar" ? "المركز القانوني" : lang === "fr" ? "Centre Légal" : lang === "es" ? "Centro Legal" : lang === "de" ? "Rechtszentrum" : "Legal Center"}
        </h1>
        <p className="mt-2 text-muted-foreground text-sm">
          {lang === "ar" ? "قوانين مُكيَّفة حسب دولتك — شفافية كاملة" : "Country-adaptive compliance — full transparency"}
        </p>

        {/* Active country badge */}
        <div className="inline-flex items-center gap-2 mt-4 bg-yellow-500/10 border border-yellow-500/30 rounded-full px-4 py-2">
          <span className="text-xl">{country.flag}</span>
          <span className="text-yellow-400 font-semibold text-sm">{country.name}</span>
          <span className="text-muted-foreground text-xs">— {country.laws.slice(0, 2).join(", ")}</span>
        </div>
      </div>

      {/* Coin disclaimer banner */}
      {country.coinsDisclaimer && (
        <div className="bg-orange-950/40 border-b border-orange-500/30 px-6 py-3">
          <p className="max-w-4xl mx-auto text-orange-300 text-xs leading-relaxed">{disclaimer}</p>
        </div>
      )}

      {/* Gaming warning banner */}
      {country.gamingWarning && (
        <div className="bg-red-950/30 border-b border-red-500/20 px-6 py-2">
          <p className="max-w-4xl mx-auto text-destructive text-xs text-center">
            {lang === "ar"
              ? `⚠️ ألعاب الحظ محدودة أو مقيّدة في ${country.name}. Arena Qaisypro ليست منصة قمار — الكوينز افتراضية فقط.`
              : `⚠️ Gaming regulations apply in ${country.name}. Arena Qaisypro is not a gambling platform — all coins are virtual only.`}
          </p>
        </div>
      )}

      {/* Tabs */}
      <div className="flex overflow-x-auto border-b border-border px-4">
        {(Object.keys(tabLabels) as Tab[]).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-3 text-xs tracking-widest whitespace-nowrap transition-all flex-shrink-0 ${
              tab === t ? "text-yellow-400 border-b-2 border-yellow-400" : "text-muted-foreground hover:text-foreground"
            }`}>
            {tabLabels[t]}
          </button>
        ))}
      </div>

      <div className="max-w-4xl mx-auto px-4 mt-8">
        <AnimatePresence mode="wait">

          {/* ── COUNTRY SELECTOR ── */}
          {tab === "country" && (
            <motion.div key="country" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <p className="text-muted-foreground text-sm mb-4">
                {lang === "ar" ? "اختر دولتك لتطبيق القوانين المناسبة تلقائياً:" : "Select your country to apply the correct legal framework automatically:"}
              </p>
              <input
                value={search} onChange={e => setSearch(e.target.value)}
                placeholder={lang === "ar" ? "ابحث عن دولتك..." : "Search your country..."}
                className="w-full bg-card border border-border rounded-xl px-4 py-3 text-foreground mb-4 focus:outline-none focus:border-yellow-500"
              />
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {filtered.map((c: CountryProfile) => (
                  <button key={c.code} onClick={() => setCountry(c.code)}
                    className={`text-left p-4 rounded-xl border transition-all ${
                      country.code === c.code
                        ? "border-yellow-500 bg-yellow-500/10"
                        : "border-border hover:border-muted-foreground"
                    }`}>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-2xl">{c.flag}</span>
                      <span className="font-semibold text-foreground text-sm">{c.name}</span>
                    </div>
                    <div className="flex flex-wrap gap-1 mt-2">
                      {c.gdpr && <span className="text-xs bg-blue-900/50 text-blue-300 px-1.5 py-0.5 rounded">GDPR</span>}
                      {c.ccpa && <span className="text-xs bg-green-900/50 text-green-300 px-1.5 py-0.5 rounded">CCPA</span>}
                      {c.cookieConsentRequired && <span className="text-xs bg-yellow-900/50 text-yellow-300 px-1.5 py-0.5 rounded">🍪</span>}
                      {c.ageGateRequired && <span className="text-xs bg-red-900/50 text-red-300 px-1.5 py-0.5 rounded">{c.minAge}+</span>}
                      {c.gamingWarning && <span className="text-xs bg-orange-900/50 text-orange-300 px-1.5 py-0.5 rounded">⚠️</span>}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1 truncate">{c.laws.slice(0,2).join(" · ")}</div>
                    {c.notes && <div className="text-xs text-muted-foreground mt-1 line-clamp-2">{c.notes}</div>}
                  </button>
                ))}
              </div>

              {/* Active framework summary */}
              <div className="mt-6 border border-yellow-500/20 rounded-xl p-5 bg-yellow-500/5">
                <h3 className="text-yellow-400 font-bold mb-3">
                  {lang === "ar" ? `الإطار القانوني المطبّق — ${country.name}` : `Active Legal Framework — ${country.name}`}
                </h3>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  {[
                    { label: lang==="ar" ? "سن قسم الألعاب" : "Games Minimum Age", value: "18+" },
                    { label: "GDPR", value: country.gdpr ? "✅" : "—" },
                    { label: "CCPA", value: country.ccpa ? "✅" : "—" },
                    { label: lang==="ar" ? "موافقة الكوكيز" : "Cookie Consent", value: country.cookieConsentRequired ? "✅ Required" : "Optional" },
                    { label: lang==="ar" ? "تحذير الألعاب" : "Gaming Warning", value: country.gamingWarning ? "⚠️ Active" : "None" },
                    { label: lang==="ar" ? "تنبيه الكوينز" : "Coins Disclaimer", value: country.coinsDisclaimer ? "⚠️ Active" : "None" },
                  ].map(r => (
                    <div key={r.label} className="flex justify-between">
                      <span className="text-muted-foreground">{r.label}</span>
                      <span className="text-foreground font-semibold">{r.value}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-3 pt-3 border-t border-yellow-500/10">
                  <p className="text-xs text-muted-foreground">
                    {lang==="ar" ? "القوانين المطبّقة:" : "Applicable laws:"}{" "}
                    <span className="text-yellow-400">{country.laws.join(" · ")}</span>
                  </p>
                </div>
              </div>
            </motion.div>
          )}

          {/* ── TERMS OF SERVICE ── */}
          {tab === "terms" && (
            <motion.div key="terms" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="prose prose-invert max-w-none space-y-6">
              <LegalSection title={lang==="ar" ? "شروط الاستخدام" : lang==="fr" ? "Conditions Générales d'Utilisation" : lang==="es" ? "Términos de Servicio" : lang==="de" ? "Nutzungsbedingungen" : "Terms of Service"} subtitle={`Arena Qaisypro — ${new Date().getFullYear()}`}>
                <LegalClause n={1} title={lang==="ar" ? "القبول" : "Acceptance"}>
                  {lang==="ar"
                    ? "باستخدامك لمنصة Arena Qaisypro، فإنك توافق على هذه الشروط. إذا كنت لا توافق، يرجى عدم استخدام المنصة."
                    : "By accessing Arena Qaisypro, you agree to these Terms. If you do not agree, please do not use the platform."}
                </LegalClause>
                <LegalClause n={2} title={lang==="ar" ? "الأهلية" : "Eligibility"}>
                  {lang==="ar"
                    ? "جميع الأعمار يمكنها استخدام المنصة. قسم الألعاب وحده يتطلب +18 حسب قوانين بلدك."
                    : "The platform is open to all ages. Only the Games section requires users to be 18+ under local law."}
                </LegalClause>
                <LegalClause n={3} title={lang==="ar" ? "العملة الافتراضية" : "Virtual Currency"}>
                  {disclaimer}
                </LegalClause>
                <LegalClause n={4} title={lang==="ar" ? "المحتوى" : "Content"}>
                  {lang==="ar"
                    ? "جميع المحتوى الذي تنشره يبقى ملكك. تمنحنا ترخيصاً لعرضه على المنصة. نحتفظ بحق إزالة أي محتوى ينتهك القوانين أو شروط الاستخدام."
                    : "Content you post remains yours. You grant us a license to display it on the platform. We reserve the right to remove content that violates laws or these Terms."}
                </LegalClause>
                <LegalClause n={5} title={lang==="ar" ? "إخلاء المسؤولية" : "Disclaimer"}>
                  {lang==="ar"
                    ? 'المنصة مقدمة "كما هي" دون ضمانات. لا نتحمل مسؤولية أي خسائر ناجمة عن استخدام المنصة.'
                    : 'The platform is provided "as is" without warranties. We are not liable for any losses arising from use of the platform.'}
                </LegalClause>
                <LegalClause n={6} title={lang==="ar" ? "القانون الحاكم" : "Governing Law"}>
                  {lang==="ar"
                    ? `تخضع هذه الشروط للقانون الدولي المعمول به في ${country.name}: ${country.laws.join("، ")}.`
                    : `These Terms are governed by applicable law in ${country.name}: ${country.laws.join(", ")}.`}
                </LegalClause>
              </LegalSection>
            </motion.div>
          )}

          {/* ── PRIVACY POLICY ── */}
          {tab === "privacy" && (
            <motion.div key="privacy" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-6">
              <LegalSection title={lang==="ar" ? "سياسة الخصوصية" : lang==="fr" ? "Politique de Confidentialité" : lang==="es" ? "Política de Privacidad" : lang==="de" ? "Datenschutzerklärung" : "Privacy Policy"} subtitle={`${country.flag} ${country.name} — ${country.laws.slice(0,2).join(", ")}`}>
                <LegalClause n={1} title={lang==="ar" ? "البيانات التي نجمعها" : "Data We Collect"}>
                  {lang==="ar"
                    ? "نجمع: اسم المستخدم، البريد الإلكتروني، نشاط المنصة (ألعاب، تصويت، منشورات)، بيانات الجهاز، ولغة المتصفح."
                    : "We collect: username, email, platform activity (games, votes, posts), device data, and browser language."}
                </LegalClause>
                <LegalClause n={2} title={lang==="ar" ? "كيف نستخدم بياناتك" : "How We Use Your Data"}>
                  {lang==="ar"
                    ? "نستخدم بياناتك لتشغيل الخدمة، تحسين التجربة، منع الاحتيال، والامتثال للقوانين. لا نبيع بياناتك لأطراف ثالثة."
                    : "We use your data to operate the service, improve experience, prevent fraud, and comply with law. We never sell your data."}
                </LegalClause>
                {country.gdpr && (
                  <LegalClause n={3} title="GDPR — Legal Basis">
                    We process your data under: Contractual necessity (Art. 6(1)(b)), Legitimate interests (Art. 6(1)(f)), and Consent (Art. 6(1)(a)) for optional analytics.
                  </LegalClause>
                )}
                {country.ccpa && (
                  <LegalClause n={3} title="CCPA — California Rights">
                    California residents have the right to know what personal information is collected, the right to delete, the right to opt-out of sale, and the right to non-discrimination.
                  </LegalClause>
                )}
                <LegalClause n={country.gdpr || country.ccpa ? 4 : 3} title={lang==="ar" ? "الاحتفاظ بالبيانات" : "Data Retention"}>
                  {lang==="ar"
                    ? "نحتفظ ببياناتك طالما حسابك نشط. عند حذف الحساب، يتم حذف بياناتك خلال 30 يوماً."
                    : "We retain your data while your account is active. Upon account deletion, your data is removed within 30 days."}
                </LegalClause>
                <LegalClause n={country.gdpr || country.ccpa ? 5 : 4} title={lang==="ar" ? "الذكاء الاصطناعي" : "AI Processing"}>
                  {lang==="ar"
                    ? "تستخدم المنصة OpenAI لمعالجة المحتوى والمودريشن. البيانات المرسلة لـ OpenAI تخضع لسياسة خصوصية OpenAI."
                    : "The platform uses OpenAI for content moderation and AI features. Data sent to OpenAI is subject to OpenAI's privacy policy."}
                </LegalClause>
              </LegalSection>
            </motion.div>
          )}

          {/* ── COOKIES ── */}
          {tab === "cookies" && (
            <motion.div key="cookies" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-6">
              <LegalSection title={lang==="ar" ? "سياسة الكوكيز" : "Cookie Policy"} subtitle={country.cookieConsentRequired ? (lang==="ar" ? "⚠️ الموافقة مطلوبة في بلدك" : "⚠️ Consent required in your country") : (lang==="ar" ? "الموافقة اختيارية في بلدك" : "Consent optional in your country")}>
                <div className="space-y-3">
                  {[
                    { name: "gdna_session", type: lang==="ar" ? "ضروري" : "Essential", purpose: lang==="ar" ? "جلسة تسجيل الدخول" : "Login session", canReject: false },
                    { name: "gdna_lang",    type: lang==="ar" ? "ضروري" : "Essential", purpose: lang==="ar" ? "تفضيل اللغة" : "Language preference", canReject: false },
                    { name: "gdna_country", type: lang==="ar" ? "ضروري" : "Essential", purpose: lang==="ar" ? "إعداد الامتثال القانوني" : "Legal compliance setup", canReject: false },
                    { name: "gdna_consent", type: lang==="ar" ? "ضروري" : "Essential", purpose: lang==="ar" ? "تتبع موافقتك" : "Consent tracking", canReject: false },
                    { name: "gdna_age_ok",  type: lang==="ar" ? "ضروري" : "Essential", purpose: lang==="ar" ? "التحقق من عمر قسم الألعاب" : "Games age verification", canReject: false },
                    { name: "_analytics",   type: lang==="ar" ? "اختياري" : "Analytics", purpose: lang==="ar" ? "تحسين الأداء" : "Performance improvement", canReject: true },
                  ].map(c => (
                    <div key={c.name} className="border border-border rounded-xl p-4 flex items-start justify-between gap-4">
                      <div>
                        <code className="text-yellow-400 text-xs">{c.name}</code>
                        <p className="text-foreground text-sm mt-0.5">{c.purpose}</p>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${c.canReject ? "bg-blue-900/50 text-blue-300" : "bg-green-900/50 text-green-300"}`}>{c.type}</span>
                        {c.canReject && <span className="text-xs text-muted-foreground">{lang==="ar" ? "قابل للرفض" : "Can reject"}</span>}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Consent control */}
                <div className="mt-6 border border-yellow-500/20 rounded-xl p-5 bg-yellow-500/5">
                  <h3 className="text-yellow-400 font-bold mb-3 text-sm">
                    {lang==="ar" ? "إدارة موافقتك" : "Manage Your Consent"}
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {([["full", lang==="ar" ? "✅ قبول الكل" : "✅ Accept All", "bg-yellow-500 text-black"],
                       ["essential", lang==="ar" ? "🔒 الضروري فقط" : "🔒 Essential Only", "bg-secondary text-foreground"],
                       ["none", lang==="ar" ? "❌ رفض الكل" : "❌ Reject All", "border border-border text-muted-foreground"]] as const).map(([level, label, cls]) => (
                      <button key={level} onClick={() => setConsent(level)}
                        className={`text-xs font-bold px-4 py-2 rounded-lg transition-all ${cls} ${consent===level?"ring-2 ring-yellow-400":""}`}>
                        {label}
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground mt-3">
                    {lang==="ar" ? `الحالة الحالية: ${consent === "full" ? "✅ قبول الكل" : consent === "essential" ? "🔒 الضروري فقط" : "❌ لم تختر بعد"}` : `Current status: ${consent === "full" ? "✅ Full consent" : consent === "essential" ? "🔒 Essential only" : "❌ Not set"}`}
                  </p>
                </div>
              </LegalSection>
            </motion.div>
          )}

          {/* ── YOUR RIGHTS ── */}
          {tab === "rights" && (
            <motion.div key="rights" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-4">
              <div className="border border-yellow-500/20 rounded-xl p-5 bg-yellow-500/5 mb-4">
                <p className="text-yellow-400 text-sm font-semibold">
                  {lang==="ar" ? `حقوقك بموجب قوانين ${country.name}:` : `Your rights under ${country.name} law (${country.laws.join(", ")}):`}
                </p>
              </div>
              {country.dataRights.map((right, i) => {
                const RIGHTS_TEXT: Record<string, Record<string, string>> = {
                  access:         { en:"Right to Access — Request a copy of all personal data we hold about you.", ar:"حق الوصول — طلب نسخة من جميع بياناتك الشخصية لدينا.", fr:"Droit d'accès — Demander une copie de vos données personnelles." },
                  delete:         { en:"Right to Erasure — Request deletion of your account and all associated data.", ar:"حق المحو — طلب حذف حسابك وجميع بياناتك.", fr:"Droit à l'effacement — Demander la suppression de votre compte." },
                  portability:    { en:"Right to Portability — Receive your data in a machine-readable format.", ar:"حق النقل — استلام بياناتك بصيغة قابلة للقراءة الآلية.", fr:"Droit à la portabilité — Recevoir vos données dans un format portable." },
                  rectification:  { en:"Right to Rectification — Correct any inaccurate personal data.", ar:"حق التصحيح — تصحيح أي بيانات شخصية غير دقيقة.", fr:"Droit de rectification — Corriger vos données inexactes." },
                  object:         { en:"Right to Object — Object to processing based on legitimate interests.", ar:"حق الاعتراض — الاعتراض على المعالجة.", fr:"Droit d'opposition — Vous opposer au traitement." },
                  "opt-out-sale": { en:"Right to Opt-Out of Sale — Opt out of the sale of your personal information (CCPA).", ar:"حق الرفض — رفض بيع معلوماتك الشخصية (CCPA).", fr:"Droit d'opt-out — Refuser la vente de vos données (CCPA)." },
                };
                const text = RIGHTS_TEXT[right]?.[lang] ?? RIGHTS_TEXT[right]?.["en"] ?? right;
                return (
                  <div key={right} className="border border-border rounded-xl p-4 flex items-start gap-3">
                    <span className="text-yellow-400 font-black text-lg mt-0.5">{i + 1}</span>
                    <p className="text-foreground/90 text-sm leading-relaxed">{text}</p>
                  </div>
                );
              })}
              {/* Contact */}
              <div className="border border-accent/20 bg-accent/5 rounded-xl p-5 mt-4">
                <p className="text-accent text-sm">
                  {lang==="ar"
                    ? "لممارسة أي من هذه الحقوق، تواصل معنا عبر: legal@gdna-arena.com — سنستجيب خلال 30 يوماً."
                    : "To exercise any of these rights, contact us at: legal@gdna-arena.com — We will respond within 30 days."}
                </p>
              </div>
            </motion.div>
          )}

        </AnimatePresence>
      </div>
    </div>
  );
}

// ── Reusable legal section wrapper ───────────────────────────
function LegalSection({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="border border-border rounded-2xl overflow-hidden">
      <div className="bg-card/50 px-6 py-4 border-b border-border">
        <h2 className="text-foreground font-black text-xl">{title}</h2>
        {subtitle && <p className="text-muted-foreground text-xs mt-1">{subtitle}</p>}
      </div>
      <div className="p-6 space-y-4">{children}</div>
    </div>
  );
}

function LegalClause({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-yellow-400 font-bold text-sm mb-1">{n}. {title}</h3>
      <p className="text-foreground/80 text-sm leading-relaxed">{children}</p>
    </div>
  );
}
