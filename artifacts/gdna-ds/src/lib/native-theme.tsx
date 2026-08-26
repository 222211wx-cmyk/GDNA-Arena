import { tokens } from "../generated/tokens";

const toPixels = (value: string) =>
  Number.parseFloat(value) * (value.endsWith("rem") ? 16 : 1);

export const nativeTheme = {
  colors: tokens.color,
  radius: toPixels(tokens.radius),
  spacing: toPixels(tokens.spacing),
  fonts: {
    regular: "Inter_400Regular",
    medium: "Inter_500Medium",
    semibold: "Inter_600SemiBold",
    bold: "Inter_700Bold",
  },
} as const;

export type NativeColors = typeof nativeTheme.colors.dark;