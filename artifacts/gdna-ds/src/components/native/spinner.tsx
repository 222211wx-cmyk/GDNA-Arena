import React from "react";
import { ActivityIndicator, type ActivityIndicatorProps } from "react-native";
import { useColors } from "../../hooks/use-colors";

export function Spinner(props: ActivityIndicatorProps) {
  const colors = useColors();
  return <ActivityIndicator accessibilityLabel="Loading" color={props.color ?? colors.primary} {...props} />;
}