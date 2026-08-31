import { createContext, useContext, useState, useEffect } from 'react';

type Language = 'en' | 'ar' | 'fr' | 'ma';

type Translations = {
  [key in Language]: {
    [key: string]: string;
  };
};

const translations: Translations = {
  en: {
    home: 'Home',
    ranking: 'Rankings',
    news: 'News',
    traditions: 'Heritage',
    about: 'About',
    vote: 'Vote',
    votes: 'Votes',
    rank: 'Rank',
    viewProfile: 'View Profile',
    liveRankings: 'Live Rankings',
    breakingNews: 'Breaking News',
    allDomains: 'All Domains',
    football: 'Football',
    music: 'Music',
    science: 'Science',
    literature: 'Literature',
    film: 'Film',
    politics: 'Politics',
    business: 'Business',
    sports: 'Sports',
    archaeology: 'Archaeology',
    traditionsLabel: 'Traditions',
    whereTheWorldVotes: 'Where the world votes',
    aiModerated: 'Powered by AI Moderation',
    aiModeratedDesc: 'All content is automatically filtered using OpenAI to ensure quality and safety.',
    voteForYourFavorites: 'Vote for your favorites across 10 global domains',
    recentActivity: 'Recent Activity',
    voteTrend: 'Vote Trend',
    bio: 'Biography',
    filterByCategory: 'Filter by Category',
    archaeological: 'Archaeological',
    cultural: 'Cultural',
    aboutPlatform: 'About GlobalStar',
    missionStatement: 'GlobalStar is the world\'s premier platform for recognizing excellence across disciplines. We bring together millions of voices to celebrate achievement in real time.',
    howItWorks: 'How It Works',
    howItWorksDesc: 'Vote for public figures across 10 domains. Rankings update live as votes come in. AI moderation ensures all content meets quality standards.',
  },
  ar: {
    home: 'الرئيسية',
    ranking: 'التصنيفات',
    news: 'الأخبار',
    traditions: 'التراث',
    about: 'حول',
    vote: 'صوّت',
    votes: 'أصوات',
    rank: 'الترتيب',
    viewProfile: 'عرض الملف',
    liveRankings: 'التصنيفات المباشرة',
    breakingNews: 'عاجل',
    allDomains: 'كل المجالات',
    football: 'كرة القدم',
    music: 'الموسيقى',
    science: 'العلوم',
    literature: 'الأدب',
    film: 'السينما',
    politics: 'السياسة',
    business: 'الأعمال',
    sports: 'الرياضة',
    archaeology: 'الآثار',
    traditionsLabel: 'التقاليد',
    whereTheWorldVotes: 'حيث يصوت العالم',
    aiModerated: 'مدعوم بالإشراف الذكي',
    aiModeratedDesc: 'يتم فلترة جميع المحتويات تلقائياً باستخدام الذكاء الاصطناعي لضمان الجودة والأمان.',
    voteForYourFavorites: 'صوّت لمفضلاتك عبر 10 مجالات عالمية',
    recentActivity: 'النشاط الأخير',
    voteTrend: 'اتجاه التصويت',
    bio: 'السيرة الذاتية',
    filterByCategory: 'تصفية حسب الفئة',
    archaeological: 'أثري',
    cultural: 'ثقافي',
    aboutPlatform: 'حول GlobalStar',
    missionStatement: 'GlobalStar هي المنصة العالمية الرائدة للاعتراف بالتميز عبر التخصصات. نجمع ملايين الأصوات للاحتفال بالإنجازات في الوقت الفعلي.',
    howItWorks: 'كيف يعمل',
    howItWorksDesc: 'صوّت للشخصيات العامة عبر 10 مجالات. تُحدث التصنيفات مباشرة مع وصول الأصوات. يضمن الإشراف الذكي استيفاء جميع المحتويات لمعايير الجودة.',
  },
  fr: {
    home: 'Accueil',
    ranking: 'Classements',
    news: 'Actualités',
    traditions: 'Patrimoine',
    about: 'À propos',
    vote: 'Voter',
    votes: 'Votes',
    rank: 'Rang',
    viewProfile: 'Voir le profil',
    liveRankings: 'Classements en direct',
    breakingNews: 'Dernière minute',
    allDomains: 'Tous les domaines',
    football: 'Football',
    music: 'Musique',
    science: 'Science',
    literature: 'Littérature',
    film: 'Cinéma',
    politics: 'Politique',
    business: 'Affaires',
    sports: 'Sports',
    archaeology: 'Archéologie',
    traditionsLabel: 'Traditions',
    whereTheWorldVotes: 'Où le monde vote',
    aiModerated: 'Modération par IA',
    aiModeratedDesc: 'Tout le contenu est automatiquement filtré par OpenAI pour garantir qualité et sécurité.',
    voteForYourFavorites: 'Votez pour vos favoris dans 10 domaines mondiaux',
    recentActivity: 'Activité récente',
    voteTrend: 'Tendance des votes',
    bio: 'Biographie',
    filterByCategory: 'Filtrer par catégorie',
    archaeological: 'Archéologique',
    cultural: 'Culturel',
    aboutPlatform: 'À propos de GlobalStar',
    missionStatement: 'GlobalStar est la principale plateforme mondiale pour reconnaître l\'excellence à travers les disciplines. Nous rassemblons des millions de voix pour célébrer les réalisations en temps réel.',
    howItWorks: 'Comment ça marche',
    howItWorksDesc: 'Votez pour des personnalités publiques dans 10 domaines. Les classements se mettent à jour en direct. La modération IA garantit que tout le contenu respecte les normes de qualité.',
  },
  ma: {
    home: 'الداخلة',
    ranking: 'الترتيبات',
    news: 'الأخبار',
    traditions: 'التراث',
    about: 'على',
    vote: 'صوّت',
    votes: 'أصوات',
    rank: 'الترتيب',
    viewProfile: 'شوف البروفيل',
    liveRankings: 'الترتيبات المباشرة',
    breakingNews: 'عاجل',
    allDomains: 'كاع المجالات',
    football: 'كورة',
    music: 'الموسيقى',
    science: 'العلوم',
    literature: 'الأدب',
    film: 'السينيما',
    politics: 'السياسة',
    business: 'التجارة',
    sports: 'الرياضة',
    archaeology: 'الآثار',
    traditionsLabel: 'التقاليد',
    whereTheWorldVotes: 'فين كيصوت العالم',
    aiModerated: 'مشغل بالذكاء الاصطناعي',
    aiModeratedDesc: 'كاع المحتوى كيتفلتر أوتوماتيكيا باستخدام الذكاء الاصطناعي باش نضمنو الجودة والأمان.',
    voteForYourFavorites: 'صوّت للي كتحب فـ 10 مجالات عالمية',
    recentActivity: 'النشاط الأخير',
    voteTrend: 'اتجاه التصويت',
    bio: 'السيرة',
    filterByCategory: 'صفّي حسب الفئة',
    archaeological: 'أثري',
    cultural: 'ثقافي',
    aboutPlatform: 'على GlobalStar',
    missionStatement: 'GlobalStar هي المنصة العالمية الرائدة باش نعرفو بالتميز فكاع التخصصات. كنجمعو ملايين الأصوات باش نحتافلو بالإنجازات فالوقت الحقيقي.',
    howItWorks: 'كيفاش خدام',
    howItWorksDesc: 'صوّت للشخصيات العامة فـ 10 مجالات. الترتيبات كيتحدثو مباشرة. الإشراف الذكي كيضمن أن كاع المحتوى كيحترم معايير الجودة.',
  },
};

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: string) => string;
  isRTL: boolean;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<Language>(() => {
    const saved = localStorage.getItem('globalstar-language');
    return saved && ['ar', 'en', 'fr'].includes(saved) ? saved as Language : 'ar';
  });

  const isRTL = language === 'ar' || language === 'ma';

  useEffect(() => {
    localStorage.setItem('globalstar-language', language);
    document.documentElement.dir = isRTL ? 'rtl' : 'ltr';
    document.documentElement.lang = language;
  }, [language, isRTL]);

  const setLanguage = (lang: Language) => {
    setLanguageState(lang);
  };

  const t = (key: string): string => {
    return translations[language][key] || key;
  };

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t, isRTL }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used within LanguageProvider');
  }
  return context;
}
