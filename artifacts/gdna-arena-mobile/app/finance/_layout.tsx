import React from 'react';
import { Stack } from 'expo-router';
import { useColors } from '@workspace/gdna-ds/hooks/use-colors';

export default function FinanceLayout() {
  const colors = useColors();
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen name="index" />
      <Stack.Screen name="onboarding" />
    </Stack>
  );
}
