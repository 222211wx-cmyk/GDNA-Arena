/** "Accueil et Guide" — shown on demand only, and once automatically for a brand-new user. */
const SEEN_KEY = "gdna.clipGuideSeen";

export const guideSeen = () => {
  try { return localStorage.getItem(SEEN_KEY) === "1"; } catch { return true; }
};
export const markGuideSeen = () => {
  try { localStorage.setItem(SEEN_KEY, "1"); } catch { /* storage unavailable */ }
};

export const guideHtml = `
<h3>الاستقبال والإرشادات — Accueil et Guide</h3>
<p>هاد الموقع ذكي: كتنشر أولا، والنظام كيراقب بعد. — Vous publiez d'abord, le système contrôle ensuite.</p>
<ul>
<li>1. اختر فيديو/صوت — Choisissez un fichier.</li>
<li>2. دير عنوان — Donnez un titre.</li>
<li>3. اضغط نشر — Appuyez sur « Publier ». Fini.</li>
</ul>
<p>مقبول ✅ / Accepté : محتوى ديالك، 30 ثانية أو أكثر، ماشي مسروق ولا تافه. — Votre contenu, 30 s minimum, ni volé ni trivial.</p>
<p>غير مقبول ❌ / Refusé : le système vous dit la raison en une phrase.</p>
<label><span>كاز لطرح السؤال — Poser une question</span>
<input id="guide-question" type="text" dir="auto" autocomplete="off"></label>
<button id="guide-ask" class="secondary" type="button">Poser une question</button>
<p id="guide-answer" class="muted" role="status" aria-live="polite"></p>`;

const FAQ: Array<[RegExp, string]> = [
  [/dur[ée]e|minute|seconde|30|مدة|ثانية|وقت|طويل|قصير/i,
    "30 secondes minimum, sans maximum. / 30 ثانية أو أكثر، بلا سقف."],
  [/refus|pourquoi|raison|رفض|علاش|لماذا|مرفوض/i,
    "Refusé = trop court (< 30 s) ou titre trivial (« test », « aaa »…). La raison s'affiche après la publication. / الرفض: قصير أو عنوان تافه."],
  [/vol[ée]|copie|droit|ديالي|مسروق|حقوق/i,
    "Publiez uniquement un contenu à vous : ni volé, ni copié. / انشر فقط محتوى ديالك."],
  [/compte|inscri|login|connex|تسجيل|حساب|دخول/i,
    "Aucun compte, aucune connexion : choisissez, titrez, publiez. / بلا حساب ولا تسجيل."],
  [/comment|publier|how|كيف|نشر/i,
    "Fichier + titre + « Publier ». / ملف + عنوان + نشر."],
];
export function answerQuestion(question: string): string {
  const q = question.trim();
  if (!q) return "Écrivez votre question. / اكتب سؤالك.";
  return FAQ.find(([re]) => re.test(q))?.[1] ??
    "Fichier + titre + « Publier » : le système contrôle ensuite (30 s minimum, contenu à vous, non trivial). / ملف + عنوان + نشر، والنظام كيراقب بعد.";
}
