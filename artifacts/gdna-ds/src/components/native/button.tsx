import React from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  type PressableProps,
} from "react-native";
import { useColors } from "../../hooks/use-colors";
import { nativeTheme } from "../../lib/native-theme";

export type ButtonProps = PressableProps & {
  children?: React.ReactNode;
  variant?: "default" | "secondary" | "outline" | "ghost" | "destructive";
  size?: "default" | "sm" | "lg" | "icon";
  loading?: boolean;
};

export function Button({
  children, variant = "default", size = "default", loading, disabled, style, ...props
}: ButtonProps) {
  const colors = useColors();
  const backgroundColor = variant === "default" ? colors.primary
    : variant === "destructive" ? colors.destructive
    : variant === "secondary" ? colors.secondary : "transparent";
  const color = variant === "default" ? colors.primaryForeground
    : variant === "destructive" ? colors.destructiveForeground : colors.foreground;
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.base, styles[size],
        { backgroundColor, borderColor: colors.border, opacity: disabled || loading ? 0.5 : pressed ? 0.8 : 1 },
        style as object,
      ]}
      {...props}
    >
      {loading ? <ActivityIndicator color={color} /> :
        typeof children === "string"
          ? <Text style={[styles.label, { color }]}>{children}</Text>
          : children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { alignItems: "center", justifyContent: "center", flexDirection: "row", borderRadius: nativeTheme.radius, borderWidth: 1 },
  default: { minHeight: 44, paddingHorizontal: 16 },
  sm: { minHeight: 36, paddingHorizontal: 12 },
  lg: { minHeight: 52, paddingHorizontal: 24 },
  icon: { width: 44, height: 44, paddingHorizontal: 0 },
  label: { fontFamily: nativeTheme.fonts.semibold, fontSize: 14 },
});