import { useColorScheme } from "react-native";
import { nativeTheme } from "../lib/native-theme";

export function useColors() {
  const scheme = useColorScheme();
  return scheme === "light" ? nativeTheme.colors.light : nativeTheme.colors.dark;
}