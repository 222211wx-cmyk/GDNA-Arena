import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  Platform, ActivityIndicator, KeyboardAvoidingView, ScrollView,
} from 'react-native';
import { Link } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { useColors } from '@/hooks/useColors';
import { useAuth } from '@/contexts/AuthContext';
import { Ionicons } from '@expo/vector-icons';

export default function RegisterScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { register } = useAuth();

  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showPass, setShowPass] = useState(false);

  const handleRegister = async () => {
    if (!username || !email || !password) { setError('All fields are required.'); return; }
    if (username.length < 3) { setError('Username must be at least 3 characters.'); return; }
    if (password.length < 6) { setError('Password must be at least 6 characters.'); return; }
    setError('');
    setLoading(true);
    try {
      await register(username.trim(), email.trim().toLowerCase(), password);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Registration failed');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setLoading(false);
    }
  };

  const s = styles(colors);
  const topPad = Platform.OS === 'web' ? 67 : insets.top;

  return (
    <KeyboardAvoidingView style={s.root} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={[s.scroll, { paddingTop: topPad + 40, paddingBottom: insets.bottom + 40 }]} keyboardShouldPersistTaps="handled">
        <View style={s.logoRow}>
          <View style={s.logoBadge}>
            <Text style={s.logoG}>G</Text>
          </View>
        </View>
        <Text style={s.brand}>JOIN THE EMPIRE</Text>
        <Text style={s.tagline}>Become a citizen of GDNA Arena</Text>

        <View style={s.card}>
          <Text style={s.title}>Create Account</Text>

          {error ? (
            <View style={s.errorBox}>
              <Ionicons name="alert-circle" size={14} color={colors.destructive} />
              <Text style={s.errorText}>{error}</Text>
            </View>
          ) : null}

          <Text style={s.label}>USERNAME</Text>
          <TextInput
            style={s.input}
            value={username}
            onChangeText={setUsername}
            placeholder="YourEmpireName"
            placeholderTextColor={colors.mutedForeground}
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={20}
          />

          <Text style={s.label}>EMAIL</Text>
          <TextInput
            style={s.input}
            value={email}
            onChangeText={setEmail}
            placeholder="citizen@gdna.empire"
            placeholderTextColor={colors.mutedForeground}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
          />

          <Text style={s.label}>PASSWORD</Text>
          <View style={s.passwordRow}>
            <TextInput
              style={[s.input, s.passwordInput]}
              value={password}
              onChangeText={setPassword}
              placeholder="Min 6 characters"
              placeholderTextColor={colors.mutedForeground}
              secureTextEntry={!showPass}
              autoCapitalize="none"
            />
            <TouchableOpacity style={s.eyeBtn} onPress={() => setShowPass(v => !v)}>
              <Ionicons name={showPass ? 'eye-off' : 'eye'} size={18} color={colors.mutedForeground} />
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={[s.btn, loading && s.btnDisabled]}
            onPress={handleRegister}
            disabled={loading}
            activeOpacity={0.8}
          >
            {loading ? (
              <ActivityIndicator color={colors.primaryForeground} />
            ) : (
              <Text style={s.btnText}>Claim Your Citizenship</Text>
            )}
          </TouchableOpacity>

          <Link href="/(auth)/login" asChild>
            <TouchableOpacity style={s.linkRow}>
              <Text style={s.linkText}>Already a citizen? <Text style={s.linkHighlight}>Login</Text></Text>
            </TouchableOpacity>
          </Link>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  scroll: { paddingHorizontal: 24, alignItems: 'center' },
  logoRow: { alignItems: 'center', marginBottom: 12 },
  logoBadge: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: colors.accent,
    borderWidth: 2, borderColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: colors.primary, shadowOpacity: 0.8, shadowRadius: 20,
  },
  logoG: { fontSize: 36, fontFamily: 'Inter_700Bold', color: colors.primary },
  brand: {
    fontSize: 18, fontFamily: 'Inter_700Bold', color: colors.primary,
    letterSpacing: 4, textAlign: 'center', marginBottom: 4,
  },
  tagline: {
    fontSize: 11, fontFamily: 'Inter_400Regular', color: colors.mutedForeground,
    letterSpacing: 2, textAlign: 'center', marginBottom: 36,
  },
  card: {
    width: '100%', backgroundColor: colors.card,
    borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 24,
  },
  title: { fontSize: 20, fontFamily: 'Inter_700Bold', color: colors.foreground, marginBottom: 20 },
  errorBox: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#1a0000', borderRadius: 8, padding: 10,
    marginBottom: 16, borderWidth: 1, borderColor: colors.destructive,
  },
  errorText: { fontSize: 13, color: colors.destructive, fontFamily: 'Inter_400Regular', flex: 1 },
  label: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: colors.mutedForeground, marginBottom: 6, letterSpacing: 1 },
  input: {
    backgroundColor: colors.secondary, borderRadius: 10, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: 14, paddingVertical: 12, fontSize: 15,
    fontFamily: 'Inter_400Regular', color: colors.foreground, marginBottom: 16,
  },
  passwordRow: { position: 'relative', marginBottom: 16 },
  passwordInput: { marginBottom: 0, paddingRight: 46 },
  eyeBtn: { position: 'absolute', right: 14, top: 13 },
  btn: {
    backgroundColor: colors.primary, borderRadius: 12,
    paddingVertical: 14, alignItems: 'center', marginTop: 8,
  },
  btnDisabled: { opacity: 0.6 },
  btnText: { fontSize: 15, fontFamily: 'Inter_700Bold', color: colors.primaryForeground, letterSpacing: 1 },
  linkRow: { marginTop: 20, alignItems: 'center' },
  linkText: { fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.mutedForeground },
  linkHighlight: { color: colors.primary, fontFamily: 'Inter_600SemiBold' },
});
