// ── Social Hub i18n — English default, Arabic keyed ──────────────────────────

export const SOCIAL_T: Record<string, Record<string, string>> = {
  en: {
    title: "Social Hub",
    feed: "Feed", messages: "Messages", stories: "Stories",
    live: "Live", citizens: "Citizens", notifications: "Notifications",
    search_placeholder: "Search citizens, posts, hashtags…",
    post_placeholder: "Share your voice with the empire…",
    post_btn: "Post", post_image: "Image URL (optional)",
    like: "Like", comment: "Comment", share: "Share", save: "Save", saved: "Saved",
    comments: "Comments", write_comment: "Write a comment…",
    send: "Send", reply: "Reply",
    follow: "Follow", following: "Following", follow_back: "Follow Back",
    voice_call: "Voice Call", video_call: "Video Call", voice_note: "Voice Note",
    dm: "Message", new_group: "New Group", group_name: "Group name…",
    no_posts: "No posts yet. Be the first!", no_messages: "No messages yet.",
    no_stories: "No stories yet. Share your moment!", no_citizens: "No citizens found.",
    no_notifications: "No notifications yet", no_calls: "No call history yet",
    search_results: "Search Results", type_message: "Type a message…",
    stories_expire: "Stories expire after 24h", add_story: "Add Story",
    story_text: "Story text (max 200 chars)…", story_image: "Image URL (optional)",
    domain: "Domain", general: "General", sport: "Sport", music: "Music",
    cinema: "Cinema", tech: "Tech", art: "Arts",
    go_live: "Go Live", active_lives: "Live Now", join_live: "Join",
    login_required: "Login to interact",
    load_more: "Load More", just_now: "just now", ago: "ago",
    xp: "XP", coins: "Coins", rank: "Rank",
    all: "All", following_only: "Following",
    create_group: "Create Group", join_group: "Join",
    online: "Online", offline: "Offline",
    record_voice: "Record Voice Note", stop_recording: "Stop",
    share_copied: "Link copied!", my_profile: "My Profile",
    trending: "Trending",
    notif_comment: "commented on your post",
    notif_follow: "started following you",
    notif_reaction: "reacted to your post",
    react: "React",
    screenshot_warning: "⚠️ Screenshot may have been taken",
    call_history: "Call History", call_missed: "Missed", call_answered: "Answered",
    call_ended: "Ended", call_audio: "Voice", call_video: "Video",
    attach_image: "Attach Image", attach_file: "Attach File",
    image_url: "Paste image URL…",
    mark_read: "Mark all read",
  },
  ar: {
    title: "المركز الاجتماعي",
    feed: "المنشورات", messages: "الرسائل", stories: "القصص",
    live: "بث مباشر", citizens: "المواطنون", notifications: "الإشعارات",
    search_placeholder: "ابحث عن مواطنين، منشورات، وسوم…",
    post_placeholder: "شارك صوتك مع الإمبراطورية…",
    post_btn: "نشر", post_image: "رابط الصورة (اختياري)",
    like: "إعجاب", comment: "تعليق", share: "مشاركة", save: "حفظ", saved: "محفوظ",
    comments: "التعليقات", write_comment: "اكتب تعليقاً…",
    send: "إرسال", reply: "رد",
    follow: "متابعة", following: "يتابع", follow_back: "تابع بالمثل",
    voice_call: "مكالمة صوتية", video_call: "مكالمة فيديو", voice_note: "رسالة صوتية",
    dm: "رسالة", new_group: "مجموعة جديدة", group_name: "اسم المجموعة…",
    no_posts: "لا منشورات بعد. كن الأول!", no_messages: "لا رسائل بعد.",
    no_stories: "لا قصص بعد. شارك لحظتك!", no_citizens: "لم يُعثر على مواطنين.",
    no_notifications: "لا إشعارات بعد", no_calls: "لا سجل مكالمات بعد",
    search_results: "نتائج البحث", type_message: "اكتب رسالة…",
    stories_expire: "تنتهي القصص بعد 24 ساعة", add_story: "أضف قصة",
    story_text: "نص القصة (200 حرف كحد أقصى)…", story_image: "رابط الصورة (اختياري)",
    domain: "المجال", general: "عام", sport: "رياضة", music: "موسيقى",
    cinema: "سينما", tech: "تقنية", art: "فنون",
    go_live: "ابدأ البث", active_lives: "بث مباشر الآن", join_live: "انضم",
    login_required: "سجل دخولك للتفاعل",
    load_more: "تحميل المزيد", just_now: "الآن", ago: "منذ",
    xp: "XP", coins: "كوينز", rank: "الرتبة",
    all: "الكل", following_only: "المتابَعون",
    create_group: "إنشاء مجموعة", join_group: "انضم",
    online: "متصل", offline: "غير متصل",
    record_voice: "تسجيل رسالة صوتية", stop_recording: "إيقاف",
    share_copied: "تم نسخ الرابط!", my_profile: "ملفي",
    trending: "الأكثر تداولاً",
    notif_comment: "علّق على منشورك",
    notif_follow: "بدأ متابعتك",
    notif_reaction: "تفاعل مع منشورك",
    react: "تفاعل",
    screenshot_warning: "⚠️ ربما تم التقاط لقطة شاشة",
    call_history: "سجل المكالمات", call_missed: "فائتة", call_answered: "مُجابة",
    call_ended: "منتهية", call_audio: "صوتية", call_video: "مرئية",
    attach_image: "إرفاق صورة", attach_file: "إرفاق ملف",
    image_url: "الصق رابط الصورة…",
    mark_read: "تحديد الكل كمقروء",
  },
};

export const DOMAIN_ICONS: Record<string, string> = {
  sport: "⚽", music: "🎵", cinema: "🎬", tech: "💡", art: "🎨", general: "🌍",
};

export const GOLD = "#C9A84C";

export const DOMAINS = ["general", "sport", "music", "cinema", "tech", "art"] as const;

export function timeAgo(dateStr: string, st: Record<string, string>): string {
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (diff < 60)    return st.just_now ?? "just now";
  if (diff < 3600)  return `${Math.floor(diff / 60)}m ${st.ago ?? "ago"}`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ${st.ago ?? "ago"}`;
  return `${Math.floor(diff / 86400)}d ${st.ago ?? "ago"}`;
}

/** Derive the base API URL from Vite's BASE_URL */
export const BASE = (import.meta as any).env.BASE_URL.replace(/\/$/, "");
export const api  = (path: string) => `${BASE}${path}`;
