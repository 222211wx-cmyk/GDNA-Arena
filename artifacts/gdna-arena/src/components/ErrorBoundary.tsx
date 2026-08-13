import { Component, type ReactNode } from "react";

interface Props { children: ReactNode }
interface State { hasError: boolean }

/**
 * Global crash guard — one bad API response or render error must never
 * leave citizens staring at a black screen. Shows a gold recovery panel.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    console.error("[EMPIRE] Render crash caught by ErrorBoundary:", error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div dir="rtl" style={{
          minHeight: "60vh", display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center", gap: "1rem",
          padding: "2rem", textAlign: "center",
        }}>
          <div style={{ fontSize: "3rem" }}>👑</div>
          <h2 style={{ color: "#D4AF37", fontSize: "1.4rem", fontWeight: 700 }}>
            وقع خلل مؤقت في هذه الصفحة
          </h2>
          <p style={{ color: "#a1a1aa", maxWidth: 420 }}>
            لا داعي للخروج من الموقع — اضغط الزر وستعود الصفحة للعمل.
          </p>
          <div style={{ display: "flex", gap: "0.75rem" }}>
            <button
              onClick={() => this.setState({ hasError: false })}
              style={{ background: "#D4AF37", color: "#000", padding: "0.6rem 1.4rem", borderRadius: 8, fontWeight: 700, border: "none", cursor: "pointer" }}
            >
              إعادة المحاولة
            </button>
            <button
              onClick={() => { window.location.href = import.meta.env.BASE_URL; }}
              style={{ background: "transparent", color: "#D4AF37", padding: "0.6rem 1.4rem", borderRadius: 8, fontWeight: 700, border: "1px solid #D4AF37", cursor: "pointer" }}
            >
              العودة للرئيسية
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
