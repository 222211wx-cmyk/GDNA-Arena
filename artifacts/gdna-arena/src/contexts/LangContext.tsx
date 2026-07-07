import { createContext, useContext, useState, type ReactNode } from "react";

export type Lang = "en" | "ar" | "fr" | "dz";

export const LANGS: { code: Lang; label: string; flag: string }[] = [
  { code: "en", label: "English", flag: "🇬🇧" },
  { code: "ar", label: "العربية", flag: "🌍" },
  { code: "fr", label: "Français", flag: "🇫🇷" },
  { code: "dz", label: "الدارجة", flag: "🇲🇦" },
];

export const T: Record<Lang, Record<string, string>> = {
  en: {
    home: "Home", games: "Games", news: "News", leaderboard: "Leaderboard",
    ai: "GDN-AI", login: "Login", register: "Register", dashboard: "Dashboard",
    wallet: "Wallet", logout: "Logout",
    hero_title: "Enter the Arena", hero_sub: "Play. Win. Earn Crypto.",
    hero_btn: "Start Playing", hero_btn2: "View Leaderboard",
    select_arena: "Select Arena", compete: "Compete. Win. Earn Crypto.",
    play_now: "Play Now", playing: "Playing...",
    reward: "Reward", win_chance: "Win Chance",
    balance: "Balance", coins: "Coins",
    daily_claim: "Daily Reward Available!", daily_sub: "Claim your 100 free coins for today",
    claim_btn: "Claim +100 Coins", claiming: "Claiming...", claimed: "Daily reward claimed — come back tomorrow!",
    rank: "Rank", games_played: "Games Played", wins: "Wins", win_rate: "Win Rate",
    play_earn: "Play to Earn More",
    stats: "Stats", tx_history: "Transaction History",
    no_tx: "No transactions yet. Play a game!",
    chat_title: "GDN-AI", chat_sub: "Your legendary AI companion",
    chat_placeholder: "Ask anything in any language...",
    chat_send: "Send",
    news_title: "Arena News", news_sub: "Latest from the crypto gaming world",
    lb_title: "Leaderboard", lb_sub: "Top players by XP",
    lb_rank: "Rank", lb_player: "Player", lb_xp: "XP", lb_wins: "Wins",
    welcome: "Welcome",
    status_online: "Status: Online",
  },
  ar: {
    home: "الرئيسية", games: "الألعاب", news: "الأخبار", leaderboard: "المتصدرون",
    ai: "GDN-AI", login: "تسجيل الدخول", register: "التسجيل", dashboard: "لوحتي",
    wallet: "المحفظة", logout: "خروج",
    hero_title: "ادخل الساحة", hero_sub: "العب. انتصر. اربح كريبتو.",
    hero_btn: "ابدأ اللعب", hero_btn2: "رؤية المتصدرين",
    select_arena: "اختر الساحة", compete: "تنافس. انتصر. اربح كريبتو.",
    play_now: "العب الآن", playing: "جاري اللعب...",
    reward: "المكافأة", win_chance: "فرصة الفوز",
    balance: "الرصيد", coins: "عملات",
    daily_claim: "مكافأة يومية متاحة!", daily_sub: "احصل على 100 عملة مجانية اليوم",
    claim_btn: "احصل على +100 عملة", claiming: "جاري الاستلام...", claimed: "تم استلام المكافأة اليومية — عُد غداً!",
    rank: "الرتبة", games_played: "الألعاب", wins: "الانتصارات", win_rate: "نسبة الفوز",
    play_earn: "العب لتكسب المزيد",
    stats: "الإحصاءات", tx_history: "سجل المعاملات",
    no_tx: "لا توجد معاملات بعد. العب لعبة!",
    chat_title: "GDN-AI", chat_sub: "رفيقك الذكي الأسطوري",
    chat_placeholder: "اسأل أي شيء بأي لغة...",
    chat_send: "إرسال",
    news_title: "أخبار الساحة", news_sub: "آخر أخبار عالم كريبتو الجيمنج",
    lb_title: "المتصدرون", lb_sub: "أفضل اللاعبين حسب XP",
    lb_rank: "الترتيب", lb_player: "اللاعب", lb_xp: "XP", lb_wins: "الانتصارات",
    welcome: "مرحباً",
    status_online: "الحالة: متصل",
  },
  fr: {
    home: "Accueil", games: "Jeux", news: "Actualités", leaderboard: "Classement",
    ai: "GDN-AI", login: "Connexion", register: "S'inscrire", dashboard: "Tableau de bord",
    wallet: "Portefeuille", logout: "Déconnexion",
    hero_title: "Entrez dans l'Arène", hero_sub: "Jouez. Gagnez. Cryptos.",
    hero_btn: "Commencer", hero_btn2: "Voir le Classement",
    select_arena: "Choisir l'Arène", compete: "Compétez. Gagnez. Cryptos.",
    play_now: "Jouer", playing: "En cours...",
    reward: "Récompense", win_chance: "Chance de victoire",
    balance: "Solde", coins: "Pièces",
    daily_claim: "Récompense quotidienne disponible!", daily_sub: "Réclamez vos 100 pièces gratuites aujourd'hui",
    claim_btn: "Réclamer +100 Pièces", claiming: "Réclamation...", claimed: "Récompense réclamée — revenez demain!",
    rank: "Rang", games_played: "Parties jouées", wins: "Victoires", win_rate: "Taux de victoire",
    play_earn: "Jouer pour gagner plus",
    stats: "Statistiques", tx_history: "Historique des transactions",
    no_tx: "Aucune transaction. Jouez une partie!",
    chat_title: "GDN-AI", chat_sub: "Votre compagnon IA légendaire",
    chat_placeholder: "Posez n'importe quelle question dans n'importe quelle langue...",
    chat_send: "Envoyer",
    news_title: "Actualités de l'Arène", news_sub: "Les dernières nouvelles du gaming crypto",
    lb_title: "Classement", lb_sub: "Meilleurs joueurs par XP",
    lb_rank: "Rang", lb_player: "Joueur", lb_xp: "XP", lb_wins: "Victoires",
    welcome: "Bienvenue",
    status_online: "Statut: En ligne",
  },
  dz: {
    home: "الدار", games: "الألعاب", news: "الأخبار", leaderboard: "المراتب",
    ai: "GDN-AI", login: "دخل", register: "سجّل", dashboard: "لوحتي",
    wallet: "المحفظة", logout: "خرج",
    hero_title: "دخل للساحة", hero_sub: "العب. ربح. كسب كريبتو.",
    hero_btn: "بدا تلعب", hero_btn2: "شوف المراتب",
    select_arena: "ختار الساحة", compete: "تنافس. ربح. كسب كريبتو.",
    play_now: "العب دابا", playing: "كيلعب...",
    reward: "الجايزة", win_chance: "فرصة الربح",
    balance: "الرصيد", coins: "كوينز",
    daily_claim: "جايزة النهار متاحة!", daily_sub: "خذ 100 كوين ديال اليوم بلاش",
    claim_btn: "خذ +100 كوين", claiming: "كيتحمّل...", claimed: "خذيتي جايزة اليوم — آجي غدا!",
    rank: "الرتبة", games_played: "الألعاب", wins: "الأربحة", win_rate: "نسبة الربح",
    play_earn: "العب باش تكسب أكثر",
    stats: "الإحصاءات", tx_history: "تاريخ العمليات",
    no_tx: "ما كاين تاع عملية. العب شي لعبة!",
    chat_title: "GDN-AI", chat_sub: "جنيك الخارق الأسطوري",
    chat_placeholder: "سول على أي حاجة بأي لغة...",
    chat_send: "صيفط",
    news_title: "أخبار الساحة", news_sub: "آخر أخبار كريبتو الجيمنج",
    lb_title: "المراتب", lb_sub: "أحسن اللاعبين بـ XP",
    lb_rank: "الرتبة", lb_player: "اللاعب", lb_xp: "XP", lb_wins: "الأربحة",
    welcome: "مرحبا",
    status_online: "الحالة: متصل",
  },
};

interface LangContextType {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: string) => string;
}

const LangContext = createContext<LangContextType>({
  lang: "en",
  setLang: () => {},
  t: (k) => k,
});

export function LangProvider({ children }: { children: ReactNode }) {
  const stored = (localStorage.getItem("gdna_lang") as Lang) ?? "en";
  const [lang, setLangState] = useState<Lang>(stored);

  const setLang = (l: Lang) => {
    localStorage.setItem("gdna_lang", l);
    setLangState(l);
  };

  const t = (key: string) => T[lang][key] ?? T["en"][key] ?? key;

  return (
    <LangContext.Provider value={{ lang, setLang, t }}>
      {children}
    </LangContext.Provider>
  );
}

export function useLang() {
  return useContext(LangContext);
}
