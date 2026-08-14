/**
 * GDNA Arena Mobile — Design tokens derived from sibling web artifact.
 * Source: artifacts/gdna-arena/src/index.css
 * Primary: #00d4ff (neon cyan, HSL 191 100% 50%)
 * Theme is always dark — matches the web platform.
 */

const colors = {
  dark: {
    background: '#000000',
    foreground: '#ffffff',

    card: '#0d0d0d',
    cardForeground: '#ffffff',

    primary: '#00d4ff',
    primaryForeground: '#000000',

    secondary: '#1a1a1a',
    secondaryForeground: '#ffffff',

    muted: '#262626',
    mutedForeground: '#b3b3b3',

    accent: '#002633',
    accentForeground: '#00d4ff',

    destructive: '#ff0000',
    destructiveForeground: '#ffffff',

    border: '#006680',
    input: '#006680',
    ring: '#00d4ff',

    // Legacy aliases
    text: '#ffffff',
    tint: '#00d4ff',

    // Extra neon tones
    neonGreen: '#00ff88',
    neonPurple: '#9b59b6',
    neonOrange: '#ff8c00',
    neonYellow: '#ffd700',
  },

  light: {
    background: '#000000',
    foreground: '#ffffff',
    card: '#0d0d0d',
    cardForeground: '#ffffff',
    primary: '#00d4ff',
    primaryForeground: '#000000',
    secondary: '#1a1a1a',
    secondaryForeground: '#ffffff',
    muted: '#262626',
    mutedForeground: '#b3b3b3',
    accent: '#002633',
    accentForeground: '#00d4ff',
    destructive: '#ff0000',
    destructiveForeground: '#ffffff',
    border: '#006680',
    input: '#006680',
    ring: '#00d4ff',
    text: '#ffffff',
    tint: '#00d4ff',
    neonGreen: '#00ff88',
    neonPurple: '#9b59b6',
    neonOrange: '#ff8c00',
    neonYellow: '#ffd700',
  },

  radius: 8,
};

export default colors;
