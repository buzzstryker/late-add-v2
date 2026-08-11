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
  const { sendOtp, verifyOtp } = useAuth();

  // OTP flow state.
  //
  // SINGLE STEP, DELIBERATELY. This screen used to gate the code field behind
  // `otpSent`, which only "Send Login Code" could set — so the only way to
  // reach the code field was to request a NEW code, and requesting one mints a
  // fresh token that supersedes the previous one. That made the code we put in
  // the invite email unreachable in EVERY case, not merely when it had expired:
  // an invitee could look straight at their code and have nowhere to type it.
  // Confirmed on the live screen 2026-08-11.
  //
  // Both fields are now always visible. Sending a code is a secondary action
  // for people who don't have one or whose code has expired.
  const [otpEmail, setOtpEmail] = useState('');
  const [otpCode, setOtpCode] = useState('');
  // Confirmation that a code was just sent. Never gates the code field — it is
  // presentational only. That distinction is the whole fix; do not make any
  // input conditional on it.
  const [notice, setNotice] = useState<string | null>(null);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSendCode() {
    setError(null);
    setNotice(null);
    if (!otpEmail.trim()) {
      setError('Enter your email address first, then we can send you a code.');
      return;
    }
    setBusy(true);
    try {
      const { error: err } = await sendOtp(otpEmail);
      if (err) {
        setError(err);
      } else {
        // Any code the user already had is now superseded by this one.
        setOtpCode('');
        setNotice(`Code sent to ${otpEmail.trim()}. It can take a minute to arrive.`);
      }
    } finally {
      setBusy(false);
    }
  }

  async function onSignIn() {
    setError(null);
    setNotice(null);
    if (!otpEmail.trim()) {
      setError('Enter your email address.');
      return;
    }
    // Guard: never attempt a verify with an empty code.
    if (!otpCode.trim()) {
      setError('Enter the 6-digit code from your email.');
      return;
    }
    setBusy(true);
    try {
      const { error: err } = await verifyOtp(otpEmail, otpCode);
      if (err) setError(err);
      // On success, onAuthStateChange fires SIGNED_IN → router navigates to standings
    } finally {
      setBusy(false);
    }
  }

  // Codes are always 6 digits. Strip everything else so a pasted code carrying
  // spaces or a stray character still verifies instead of failing opaquely.
  function onChangeCode(next: string) {
    setOtpCode(next.replace(/\D/g, '').slice(0, 6));
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
            Windex
          </ThemedText>

          <ThemedText type="subtitle" style={[styles.lead, { color: muted }]}>
            Enter your email and the 6-digit code from your Windex email.
          </ThemedText>

          <View style={styles.section}>
            <TextInput
              style={inputStyle}
              placeholder="Your email address"
              placeholderTextColor={muted}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              autoComplete="email"
              textContentType="emailAddress"
              value={otpEmail}
              onChangeText={setOtpEmail}
            />
            <TextInput
              style={[inputStyle, styles.codeInput]}
              placeholder="000000"
              placeholderTextColor={muted}
              keyboardType="number-pad"
              autoComplete="one-time-code"
              textContentType="oneTimeCode"
              maxLength={6}
              value={otpCode}
              onChangeText={onChangeCode}
            />
            <Pressable
              accessibilityRole="button"
              style={[styles.buttonPrimary, busy && styles.buttonDisabled]}
              onPress={onSignIn}
              disabled={busy}>
              {busy ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <ThemedText style={styles.buttonText}>Sign In</ThemedText>
              )}
            </Pressable>
          </View>

          <View style={styles.secondary}>
            <ThemedText style={[styles.secondaryLead, { color: muted }]}>
              No code, or has it expired?
            </ThemedText>
            <Pressable
              accessibilityRole="button"
              style={[styles.buttonSecondary, { borderColor: border }, busy && styles.buttonDisabled]}
              onPress={onSendCode}
              disabled={busy}>
              <ThemedText style={[styles.buttonSecondaryText, { color: muted }]}>
                Send me a code
              </ThemedText>
            </Pressable>
          </View>

          {notice ? <ThemedText style={[styles.notice, { color: muted }]}>{notice}</ThemedText> : null}
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
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontSize: 17,
    marginBottom: 12,
  },
  codeInput: {
    fontSize: 32,
    fontWeight: '700',
    textAlign: 'center',
    letterSpacing: 12,
    paddingVertical: 18,
  },
  linkText: { fontSize: 14 },
  buttonPrimary: {
    backgroundColor: '#0a7ea4',
    borderRadius: 10,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 4,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 17 },
  // Secondary action. Visually subordinate to Sign In — outlined rather than
  // filled — so the primary path stays "I have a code", which is what an
  // invitee arrives holding.
  secondary: { marginTop: 4 },
  secondaryLead: { fontSize: 14, marginBottom: 8, textAlign: 'center' },
  buttonSecondary: {
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  buttonSecondaryText: { fontWeight: '600', fontSize: 15 },
  notice: { marginTop: 16, fontSize: 15, lineHeight: 22 },
  error: { color: '#c62828', marginTop: 16, fontSize: 15, lineHeight: 22 },
});
