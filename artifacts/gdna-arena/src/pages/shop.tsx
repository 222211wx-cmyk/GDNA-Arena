import { useState, useEffect } from "react";
import SmartDomainWidget from "@/components/SmartDomainWidget";
import { useAuth }  from "../contexts/AuthContext";
import { useLang }  from "../contexts/LangContext";
import { ShoppingBag, Coins, CheckCircle, AlertCircle, Loader2 } from "lucide-react";
import { useConnectivity } from "@/contexts/ConnectivityContext";

const GOLD = "#FFD700";
const BASE = () => (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "");
const api = (path: string) => `${BASE()}${path}`;

interface ShopItem {
  id: number; name: string; name_ar: string;
  price: number; category: string; emoji: string; image: string;
}

export default function ShopPage() {
  const { user, refreshUser } = useAuth() as any;
  const { lang } = useLang();
  const { isOnline } = useConnectivity();
  const dir = lang === "ar" ? "rtl" : "ltr";

  const [items,       setItems]       = useState<ShopItem[]>([]);
  const [purchased,   setPurchased]   = useState<number[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [buying,      setBuying]      = useState<number | null>(null);
  const [toast,       setToast]       = useState<{ msg: string; ok: boolean } | null>(null);

  useEffect(() => {
    fetch(api("/api/shop/items"), { credentials: "include" })
      .then(r => r.json())
      .then(d => { setItems(d.items ?? []); setPurchased(d.purchasedIds ?? []); })
      .finally(() => setLoading(false));
  }, [user]);

  const showToast = (msg: string, ok: boolean) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3500);
  };

  const buy = async (item: ShopItem) => {
    if (!user) return showToast(lang === "ar" ? "يجب تسجيل الدخول أولاً" : "Login required", false);
    if (!isOnline) return showToast(lang === "ar" ? "أعد الاتصال لإتمام الشراء" : "Reconnect to complete this purchase", false);
    setBuying(item.id);
    try {
      const res = await fetch(api(`/api/shop/buy/${item.id}`), {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
      });
      const d = await res.json();
      if (!res.ok) {
        showToast(d.error ?? "فشل الشراء", false);
      } else {
        setPurchased(p => [...p, item.id]);
        showToast(`✅ ${item.name_ar} — تم الشراء!`, true);
        if (refreshUser) refreshUser();
      }
    } catch {
      showToast("خطأ في الاتصال", false);
    } finally {
      setBuying(null);
    }
  };

  const CATEGORIES: Record<string, string> = {
    clothing: lang === "ar" ? "ملابس" : "Clothing",
    collectible: lang === "ar" ? "تحف" : "Collectibles",
    digital: lang === "ar" ? "رقمي" : "Digital",
    bundle: lang === "ar" ? "حزمة" : "Bundle",
  };

  return (
    <div style={{ minHeight: "100vh", background: "#050505", color: "#fff", paddingBottom: 80 }} dir={dir}>
      {/* Toast */}
      {toast && (
        <div style={{
          position: "fixed", top: 70, left: "50%", transform: "translateX(-50%)",
          background: toast.ok ? "#0a2" : "#c00", color: "#fff",
          padding: "12px 24px", borderRadius: 12, zIndex: 9999,
          boxShadow: "0 4px 20px rgba(0,0,0,0.5)", fontWeight: 700, fontSize: 14,
        }}>{toast.msg}</div>
      )}

      {/* Header */}
      <div style={{ background: `linear-gradient(135deg, #0a0a0a 0%, #111 100%)`, borderBottom: `1px solid ${GOLD}20`, padding: "32px 24px 20px" }}>
        <div style={{ maxWidth: 1100, margin: "0 auto" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
            <div>
              <h1 style={{ margin: 0, fontSize: 28, fontWeight: 900, letterSpacing: 3, textTransform: "uppercase" }}>
                <span style={{ color: GOLD }}>◈</span> {lang === "ar" ? "تجارة الإمبراطورية" : "Empire Shop"}
              </h1>
              <p style={{ margin: "4px 0 0", color: "#ffffff50", fontSize: 13 }}>
                {lang === "ar" ? "أنفق عملات GDNA على منتجات حصرية" : "Spend your GDNA Coins on exclusive items"}
              </p>
            </div>
            {user && (
              <div style={{
                display: "flex", alignItems: "center", gap: 8,
                background: `${GOLD}15`, border: `1px solid ${GOLD}40`,
                borderRadius: 20, padding: "8px 18px",
              }}>
                <span style={{ fontSize: 18 }}>🪙</span>
                <span style={{ color: GOLD, fontWeight: 900, fontSize: 18 }}>{(user.balance ?? 0).toLocaleString()}</span>
                <span style={{ color: "#ffffff60", fontSize: 12 }}>GDNA Coins</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Smart Domain Widget */}
      <div style={{ maxWidth: 1100, margin: "16px auto 0", padding: "0 24px" }}>
        <SmartDomainWidget domainId="business" label="Module Business" />
      </div>

      {/* Grid */}
      <div style={{ maxWidth: 1100, margin: "32px auto", padding: "0 24px" }}>
        {loading ? (
          <div style={{ textAlign: "center", padding: 60, color: "#666" }}>
            <Loader2 size={32} style={{ animation: "spin 1s linear infinite" }} />
          </div>
        ) : (
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
            gap: 20,
          }}>
            {items.map(item => {
              const isPurchased = purchased.includes(item.id);
              const isLoading   = buying === item.id;
              const canAfford   = (user?.balance ?? 0) >= item.price;

              return (
                <div key={item.id} style={{
                  background: "#0d0d0d",
                  border: `1px solid ${isPurchased ? "#0a0" : `${GOLD}20`}`,
                  borderRadius: 16, overflow: "hidden",
                  transition: "transform 0.2s, border-color 0.2s",
                  cursor: "default",
                }}>
                  {/* Image */}
                  <div style={{
                    height: 160, background: `#111`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 64, position: "relative",
                  }}>
                    {item.emoji}
                    {isPurchased && (
                      <div style={{
                        position: "absolute", top: 10, right: 10,
                        background: "#0a0", borderRadius: "50%", padding: 2,
                      }}>
                        <CheckCircle size={20} color="#fff" />
                      </div>
                    )}
                    <div style={{
                      position: "absolute", top: 10, left: 10,
                      background: `${GOLD}20`, border: `1px solid ${GOLD}40`,
                      borderRadius: 8, padding: "3px 8px", fontSize: 11, color: GOLD, fontWeight: 700,
                    }}>
                      {CATEGORIES[item.category] ?? item.category}
                    </div>
                  </div>

                  {/* Info */}
                  <div style={{ padding: "16px" }}>
                    <h3 style={{ margin: "0 0 4px", fontSize: 16, fontWeight: 800 }}>{item.name_ar}</h3>
                    <p style={{ margin: "0 0 12px", color: "#ffffff50", fontSize: 12 }}>{item.name}</p>

                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ fontSize: 16 }}>🪙</span>
                        <span style={{ color: GOLD, fontWeight: 900, fontSize: 18 }}>{item.price}</span>
                      </div>

                      <button
                        onClick={() => !isPurchased && buy(item)}
                        disabled={isPurchased || isLoading || !canAfford || !isOnline}
                        style={{
                          padding: "8px 16px", borderRadius: 10, border: "none",
                          fontWeight: 800, fontSize: 13, cursor: isPurchased || !canAfford ? "not-allowed" : "pointer",
                          background: isPurchased
                            ? "#1a3a1a"
                            : canAfford ? GOLD : "#333",
                          color: isPurchased ? "#0a0" : canAfford ? "#000" : "#666",
                          transition: "all 0.2s",
                          display: "flex", alignItems: "center", gap: 6,
                        }}>
                        {isLoading ? <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> : null}
                        {isPurchased
                          ? (lang === "ar" ? "✓ مشتراة" : "✓ Owned")
                          : !canAfford
                          ? (lang === "ar" ? "رصيد غير كافٍ" : "Not enough")
                          : (lang === "ar" ? "شراء" : "Buy")}
                      </button>
                    </div>

                    {!canAfford && !isPurchased && user && (
                      <p style={{ margin: "8px 0 0", fontSize: 11, color: "#c44", textAlign: "center" }}>
                        {lang === "ar" ? `تحتاج ${item.price - (user.balance ?? 0)} عملة إضافية` : `Need ${item.price - (user.balance ?? 0)} more coins`}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {!user && (
          <div style={{ textAlign: "center", padding: "60px 20px", color: "#666" }}>
            <ShoppingBag size={48} style={{ marginBottom: 16, opacity: 0.3 }} />
            <p style={{ fontSize: 16 }}>{lang === "ar" ? "سجّل دخولك لتتمكن من الشراء" : "Login to make purchases"}</p>
          </div>
        )}
      </div>
    </div>
  );
}
