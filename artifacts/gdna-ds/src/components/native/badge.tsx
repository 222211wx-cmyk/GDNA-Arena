import React from "react";
import { View, StyleSheet, type ViewProps } from "react-native";
import { useColors } from "../../hooks/use-colors";
import { nativeTheme } from "../../lib/native-theme";

export function Badge({ style, ...props }: ViewProps) {
  const colors = useColors();
  return <View style={[styles.badge, { backgroundColor: colors.secondary, borderColor: colors.border }, style]} {...props} />;
}
const styles = StyleSheet.create({
  badge: { alignSelf: "flex-start", minHeight: 24, paddingHorizontal: 8, justifyContent: "center", borderRadius: nativeTheme.radius, borderWidth: 1 },
});