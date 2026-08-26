import React from "react";
import { StyleSheet, View, type ViewProps } from "react-native";
import { useColors } from "../../hooks/use-colors";
import { nativeTheme } from "../../lib/native-theme";

export function Card({ style, ...props }: ViewProps) {
  const colors = useColors();
  return <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }, style]} {...props} />;
}
const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: nativeTheme.radius * 2, padding: nativeTheme.spacing * 4 },
});