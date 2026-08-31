/* GENERATED FROM tokens.json -- DO NOT EDIT. Run scripts/build-tokens.mjs. */
// Portable design tokens (colors as hex). Web consumes the theme via
// src/index.css; mobile (Expo) and any other platform import this object so the
// whole product shares one source of truth.
export const tokens = {
  "color": {
    "light": {
      "background": "#faf8f2",
      "foreground": "#17130d",
      "border": "#e6dcc3",
      "card": "#ffffff",
      "cardForeground": "#17130d",
      "popover": "#ffffff",
      "popoverForeground": "#17130d",
      "primary": "#d4af37",
      "primaryForeground": "#ffffff",
      "secondary": "#f3edda",
      "secondaryForeground": "#17130d",
      "muted": "#f0ead6",
      "mutedForeground": "#6b6046",
      "accent": "#0891b2",
      "accentForeground": "#ffffff",
      "destructive": "#dc2626",
      "destructiveForeground": "#ffffff",
      "input": "#e6dcc3",
      "ring": "#d4af37",
      "chart1": "#d4af37",
      "chart2": "#0891b2",
      "chart3": "#16a34a",
      "chart4": "#9333ea",
      "chart5": "#dc2626",
      "sidebar": "#f6f1e3",
      "sidebarForeground": "#3d3421",
      "sidebarBorder": "#e6dcc3",
      "sidebarPrimary": "#d4af37",
      "sidebarPrimaryForeground": "#ffffff",
      "sidebarAccent": "#ece2c8",
      "sidebarAccentForeground": "#17130d",
      "sidebarRing": "#d4af37"
    },
    "dark": {
      "background": "#000000",
      "foreground": "#ffffff",
      "border": "#3d3421",
      "card": "#0d0d0d",
      "cardForeground": "#ffffff",
      "popover": "#0d0d0d",
      "popoverForeground": "#ffffff",
      "primary": "#d4af37",
      "primaryForeground": "#000000",
      "secondary": "#1a1a1a",
      "secondaryForeground": "#ffffff",
      "muted": "#262626",
      "mutedForeground": "#b3b3b3",
      "accent": "#00d4ff",
      "accentForeground": "#000000",
      "destructive": "#ef4444",
      "destructiveForeground": "#ffffff",
      "input": "#3d3421",
      "ring": "#d4af37",
      "chart1": "#d4af37",
      "chart2": "#00d4ff",
      "chart3": "#25d366",
      "chart4": "#a855f7",
      "chart5": "#ef4444",
      "sidebar": "#0d0d0d",
      "sidebarForeground": "#ffffff",
      "sidebarBorder": "#3d3421",
      "sidebarPrimary": "#d4af37",
      "sidebarPrimaryForeground": "#000000",
      "sidebarAccent": "#1f1a10",
      "sidebarAccentForeground": "#e7ce8b",
      "sidebarRing": "#d4af37"
    }
  },
  "fontFamily": {
    "sans": [
      "Inter",
      "sans-serif"
    ],
    "serif": [
      "Georgia",
      "serif"
    ],
    "mono": [
      "JetBrains Mono",
      "monospace"
    ]
  },
  "radius": "0.5rem",
  "spacing": "0.25rem"
} as const;

export type Tokens = typeof tokens;
export default tokens;
