import { Stack } from 'expo-router';
import { useColors } from '@workspace/gdna-ds/hooks/use-colors';

export default function AuthLayout() {
  const colors = useColors();
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }} />
  );
}
