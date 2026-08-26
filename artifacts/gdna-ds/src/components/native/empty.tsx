import React from "react";
import { View, StyleSheet, type ViewProps } from "react-native";
import { nativeTheme } from "../../lib/native-theme";

export function Empty({ style, ...props }: ViewProps) {
  return <View accessibilityRole="summary" style={[styles.empty, style]} {...props} />;
}
const styles = StyleSheet.create({
  empty: { alignItems: "center", justifyContent: "center", gap: nativeTheme.spacing * 3, padding: nativeTheme.spacing * 8 },
});