// Placeholder design tokens: original @workspace/gdna-ds is missing from the repository.
const palette: Record<string, string> = {
  background: "#0d0d0d",
  foreground: "#ffffff",
  card: "#1a1a1a",
  cardForeground: "#ffffff",
  popover: "#0d0d0d",
  popoverForeground: "#ffffff",
  primary: "#d4af37",
  primaryForeground: "#0d0d0d",
  secondary: "#1a1a1a",
  secondaryForeground: "#ffffff",
  muted: "#262626",
  mutedForeground: "#b3b3b3",
  border: "#333333",
  ring: "#d4af37",
};

export const tokens = {
  radius: "0.25rem",
  spacing: "0.25rem",
  color: { dark: palette, light: palette },
};
