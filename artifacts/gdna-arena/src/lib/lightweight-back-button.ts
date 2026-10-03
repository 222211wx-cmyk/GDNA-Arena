import { tokens } from "@workspace/gdna-ds/tokens";

/** The non-React Clips/Lite shells must not load React just for navigation. */
export function mountLightweightBackButton() {
  if (document.getElementById("global-back-button")) return;
  const button = document.createElement("button");
  button.id = "global-back-button";
  button.type = "button";
  button.textContent = "→";
  button.setAttribute("aria-label", "رجوع");
  button.title = "رجوع";
  const palette = tokens.color.dark;
  Object.assign(button.style, {
    position: "fixed", top: `calc(${tokens.spacing} * 4)`,
    right: `calc(${tokens.spacing} * 4)`, zIndex: "50",
    width: `calc(${tokens.spacing} * 10)`, height: `calc(${tokens.spacing} * 10)`,
    borderRadius: "50%", background: palette.background, color: palette.foreground,
    border: `1px solid ${palette.border}`, cursor: "pointer",
    display: "grid", placeItems: "center",
  });
  button.onclick = () => {
    if (history.length > 1) history.back();
    else location.assign(import.meta.env.BASE_URL);
  };
  document.body.append(button);
}