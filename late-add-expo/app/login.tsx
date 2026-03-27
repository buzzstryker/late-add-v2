import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useAuth } from '@/contexts/AuthContext';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const muted = Colors[colorScheme ?? 'light'].icon;
  const border = colorScheme === 'dark' ? '#444' : '#ccc';
  const inputBg = colorScheme === 'dark' ? '#1c1c1e' : '#f5f5f5';
  const { signInWithPassword, signInWithOtp } = useAuth();

  const [magicEmail, setMagicEmail] = useState('');
  const [magicSent, setMagicSent] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onMagicLink() {
    setError(null);
    setMagicSent(false);
    if (!magicEmail.trim()) {
      setError('Enter your email address.');
      return;
    }
    setBusy(true);
    try {
      const { error: err } = await signInWithOtp(magicEmail);
      if (err) setError(err);
      else setMagicSent(true);
    } finally {
      setBusy(false);
    }
  }

  async function onEmailSignIn() {
    setError(null);
    if (!email.trim() || !password) {
      setError('Enter email and password.');
      return;
    }
    setBusy(true);
    try {
      const { error: err } = await signInWithPassword(email, password);
      if (err) setError(err);
    } finally {
      setBusy(false);
    }
  }

  const inputStyle = [
    styles.input,
    {
      borderColor: border,
      backgroundColor: inputBg,
      color: colorScheme === 'dark' ? '#fff' : '#111',
    },
  ];

  return (
    <ThemedView style={[styles.screen, { paddingTop: insets.top + 16 }]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 32 }]}>
          <ThemedText type="title" style={styles.title}>
            Late Add
          </ThemedText>
          <ThemedText type="subtitle" style={[styles.lead, { color: muted }]}>
            Enter your email to receive a login link.
          </ThemedText>

          <View style={styles.section}>
            <TextInput
              style={inputStyle}
              placeholder="Your email address"
              placeholderTextColor={muted}
              autoCapitalize="none"
              keyboardType="email-address"
              autoComplete="email"
              textContentType="emailAddress"
              value={magicEmail}
              onChangeText={(t) => { setMagicEmail(t); setMagicSent(false); }}
            />
            <Pressable
              style={[styles.buttonPrimary, busy && styles.buttonDisabled]}
              onPress={onMagicLink}
              disabled={busy}>
              {busy ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <ThemedText style={styles.buttonText}>Send Login Link</ThemedText>
              )}
            </Pressable>
            {magicSent ? (
              <View
                style={[
                  styles.callout,
                  {
                    borderColor: '#2e7d32',
                    backgroundColor: colorScheme === 'dark' ? '#1a2e1a' : '#e8f5e9',
                    marginTop: 12,
                  },
                ]}>
                <ThemedText style={[styles.calloutText, { color: colorScheme === 'dark' ? '#a5d6a7' : '#2e7d32' }]}>
                  Check your email for a login link. Tap it to sign in automatically.
                </ThemedText>
              </View>
            ) : null}
          </View>

          {!showPassword ? (
            <Pressable onPress={() => setShowPassword(true)} style={styles.passwordToggle}>
              <ThemedText style={[styles.passwordToggleText, { color: muted }]}>
                Sign in with password instead
              </ThemedText>
            </Pressable>
          ) : (
            <View style={styles.section}>
              <View style={styles.divider}>
                <View style={[styles.dividerLine, { backgroundColor: border }]} />
                <ThemedText style={[styles.dividerText, { color: muted }]}>or</ThemedText>
                <View style={[styles.dividerLine, { backgroundColor: border }]} />
              </View>
              <TextInput
                style={inputStyle}
                placeholder="Email"
                placeholderTextColor={muted}
                autoCapitalize="none"
                keyboardType="email-address"
                autoComplete="email"
                textContentType="emailAddress"
                value={email}
                onChangeText={setEmail}
              />
              <TextInput
                style={inputStyle}
                placeholder="Password"
                placeholderTextColor={muted}
                secureTextEntry
                autoComplete="password"
                textContentType="password"
                value={password}
                onChangeText={setPassword}
              />
              <Pressable
                style={[styles.buttonSecondary, { borderColor: border }, busy && styles.buttonDisabled]}
                onPress={onEmailSignIn}
                disabled={busy}>
                {busy ? (
                  <ActivityIndicator />
                ) : (
                  <ThemedText type="defaultSemiBold">Sign in</ThemedText>
                )}
              </Pressable>
            </View>
          )}

          {error ? <ThemedText style={styles.error}>{error}</ThemedText> : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  flex: { flex: 1 },
  scroll: { paddingHorizontal: 24 },
  title: { marginBottom: 10 },
  lead: { fontSize: 17, lineHeight: 24, marginBottom: 22 },
  section: { marginBottom: 16 },
  callout: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 14,
    marginBottom: 14,
  },
  calloutText: { fontSize: 14, lineHeight: 20 },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontSize: 17,
    marginBottom: 12,
  },
  buttonPrimary: {
    backgroundColor: '#0a7ea4',
    borderRadius: 10,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 4,
  },
  buttonSecondary: {
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 4,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 17 },
  passwordToggle: { alignItems: 'center', marginTop: 8 },
  passwordToggleText: { fontSize: 14 },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  dividerLine: { flex: 1, height: StyleSheet.hairlineWidth },
  dividerText: { paddingHorizontal: 12, fontSize: 13 },
  error: { color: '#c62828', marginTop: 16, fontSize: 15, lineHeight: 22 },
});
