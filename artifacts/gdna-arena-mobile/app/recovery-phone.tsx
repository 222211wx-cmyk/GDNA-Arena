import { Redirect } from 'expo-router';
import { PhoneRecoveryScreen } from '@/components/PhoneRecoveryScreen';
import { useAuth } from '@/contexts/AuthContext';

export default function RecoveryPhoneScreen() {
  const { user, isLoading } = useAuth();
  if (isLoading) return null;
  if (!user) return <Redirect href="/(auth)/login" />;
  return <PhoneRecoveryScreen mode="settings" />;
}