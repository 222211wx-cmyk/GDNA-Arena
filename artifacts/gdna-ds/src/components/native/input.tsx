import React from "react";
import { StyleSheet, TextInput, type TextInputProps } from "react-native";
import { useColors } from "../../hooks/use-colors";
import { nativeTheme } from "../../lib/native-theme";

export function Input({ style, placeholderTextColor, ...props }: TextInputProps) {
  const colors = useColors();
  return <TextInput placeholderTextColor={placeholderTextColor ?? colors.mutedForeground}
    style={[styles.input, { color: colors.foreground, backgroundColor: colors.background, borderColor: colors.input }, style]} {...props} />;
}
const styles = StyleSheet.create({
  input: { minHeight: 44, borderWidth: 1, borderRadius: nativeTheme.radius, paddingHorizontal: 12, fontFamily: nativeTheme.fonts.regular, fontSize: 14 },
});