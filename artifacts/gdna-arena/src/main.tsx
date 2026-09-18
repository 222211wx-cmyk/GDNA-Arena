const base = import.meta.env.BASE_URL.replace(/\/$/, "");
const rawRoute = window.location.pathname.slice(base.length) || "/";
const route = rawRoute.length > 1 ? rawRoute.replace(/\/+$/, "") : rawRoute;
const isClipRoute = route === "/clip" || route === "/clips";

function showClipStartupError() {
  const root = document.getElementById("root");
  if (!root) return;
  root.innerHTML = "";
  const main = document.createElement("main");
  main.dir = "rtl";
  main.setAttribute("data-testid", "clip-startup-error");
  const message = document.createElement("p");
  message.setAttribute("role", "alert");
  message.textContent = "تعذر تشغيل صفحة الكليبز. تحقق من الاتصال وحاول مجدداً.";
  const retry = document.createElement("button");
  retry.type = "button";
  retry.setAttribute("data-testid", "clip-startup-retry");
  retry.textContent = "إعادة المحاولة";
  retry.addEventListener("click", () => window.location.reload());
  main.append(message, retry);
  root.append(main);
}

// Keep these imports in distinct branches. A conditional import expression makes
// Vite merge both dependency lists and eagerly fetch the App stylesheet.
if (isClipRoute) {
  void import("./clip-entry").catch(showClipStartupError);
} else {
  void import("./app-entry");
}
