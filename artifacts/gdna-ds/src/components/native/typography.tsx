import React from "react";
import { Text, type TextProps } from "react-native";
import { useColors } from "../../hooks/use-colors";
import { nativeTheme } from "../../lib/native-theme";

export type TypographyProps = TextProps & { variant?: "body" | "label" | "title" | "muted" };
export function Typography({ variant = "body", style, ...props }: TypographyProps) {
  const colors = useColors();
  const spec = variant === "title" ? { fontFamily: nativeTheme.fonts.bold, fontSize: 24 }
    : variant === "label" ? { fontFamily: nativeTheme.fonts.semibold, fontSize: 13 }
    : { fontFamily: nativeTheme.fonts.regular, fontSize: 14 };
  return <Text style={[spec, { color: variant === "muted" ? colors.mutedForeground : colors.foreground }, style]} {...props} />;
}