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
import { hasSupabaseAuthConfig } from '@/lib/config';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const muted = Colors[colorScheme ?? 'light'].icon;
  const border = colorScheme === 'dark' ? '#444' : '#ccc';
  const inputBg = colorScheme === 'dark' ? '#1c1c1e' : '#f5f5f5';
  const { signInWithPassword, signInWithOtp, signInWithJwt } = useAuth();

  const [magicEmail, setMagicEmail] = useState('');
  const [magicSent, setMagicSent] = useState(false);
  const [email, setEmail] = useState('dev@lateaddgolf.com');
  const [password, setPassword] = useState('testpass123');
  const [jwt, setJwt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const supabaseReady = hasSupabaseAuthConfig();

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
      setError('Enter email and password, or use JWT below.');
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

  async function onJwtContinue() {
    setError(null);
    const t = jwt.trim();
    if (!t) {
      setError('Paste a JWT, or sign in with email and password above.');
      return;
    }
    setBusy(true);
    try {
      await signInWithJwt(t);
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
            Late Add v2
          </ThemedText>
          <ThemedText type="subtitle" style={[styles.lead, { color: muted }]}>
            Enter your email to receive a login link.
          </ThemedText>

          <View style={styles.section}>
            <ThemedText type="defaultSemiBold" style={styles.sectionTitle}>
              Magic link
            </ThemedText>
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

          <View style={styles.divider}>
            <View style={[styles.dividerLine, { backgroundColor: border }]} />
            <ThemedText style={[styles.dividerText, { color: muted }]}>or</ThemedText>
            <View style={[styles.dividerLine, { backgroundColor: border }]} />
          </View>

          <View style={styles.section}>
            <ThemedText type="defaultSemiBold" style={styles.sectionTitle}>
              Email &amp; password
            </ThemedText>
            {!supabaseReady ? (
              <View
                style={[
                  styles.callout,
                  {
                    borderColor: '#b8860b',
                    backgroundColor: colorScheme === 'dark' ? '#2a2410' : '#fffbeb',
                  },
                ]}>
                <ThemedText style={[styles.calloutText, { color: muted }]}>
                  These fields always show here. Email sign-in only works after you add Supabase to a{' '}
                  <ThemedText type="defaultSemiBold">.env</ThemedText> file on the PC that runs Expo
                  (folder <ThemedText type="defaultSemiBold">late-add-expo</ThemedText>), then{' '}
                  <ThemedText type="defaultSemiBold">stop Metro and start again</ThemedText> (e.g.{' '}
                  <ThemedText type="defaultSemiBold">npx expo start -c</ThemedText>). Add:
                </ThemedText>
                <ThemedText
                  style={[styles.mono, { color: colorScheme === 'dark' ? '#e0e0e0' : '#111' }]}>
                  EXPO_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co{'\n'}
                  EXPO_PUBLIC_SUPABASE_ANON_KEY=your_publishable_or_anon_key
                </ThemedText>
                <ThemedText style={[styles.calloutText, { color: muted, marginTop: 8 }]}>
                  Create the user in Supabase → Authentication → Users. Until then, use JWT below.
                </ThemedText>
              </View>
            ) : null}
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
              style={[styles.buttonPrimary, busy && styles.buttonDisabled]}
              onPress={onEmailSignIn}
              disabled={busy}>
              {busy ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <ThemedText style={styles.buttonText}>Sign in with email</ThemedText>
              )}
            </Pressable>
          </View>

          <View style={styles.divider}>
            <View style={[styles.dividerLine, { backgroundColor: border }]} />
            <ThemedText style={[styles.dividerText, { color: muted }]}>or</ThemedText>
            <View style={[styles.dividerLine, { backgroundColor: border }]} />
          </View>

          <View style={styles.section}>
            <ThemedText type="defaultSemiBold" style={styles.sectionTitle}>
              JWT (access token)
            </ThemedText>
            <ThemedText style={[styles.hint, { color: muted }]}>
              Works without the .env lines above. Get <ThemedText type="defaultSemiBold">access_token</ThemedText>{' '}
              from the password API (see README) or Late Add admin.
            </ThemedText>
            <TextInput
              style={[
                styles.jwtInput,
                {
                  borderColor: border,
                  backgroundColor: inputBg,
                  color: colorScheme === 'dark' ? '#fff' : '#111',
                },
              ]}
              placeholder="eyJhbGciOiJIUzI1NiIs..."
              placeholderTextColor={muted}
              multiline
              autoCapitalize="none"
              value={jwt}
              onChangeText={setJwt}
            />
            <Pressable
              style={[styles.buttonSecondary, { borderColor: border }, busy && styles.buttonDisabled]}
              onPress={onJwtContinue}
              disabled={busy}>
              <ThemedText type="defaultSemiBold">Continue with JWT</ThemedText>
            </Pressable>
          </View>

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
  sectionTitle: { marginBottom: 10 },
  hint: { fontSize: 14, lineHeight: 20, marginBottom: 12 },
  callout: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 14,
    marginBottom: 14,
  },
  calloutText: { fontSize: 14, lineHeight: 20 },
  mono: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 12,
    marginTop: 10,
    lineHeight: 18,
  },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontSize: 17,
    marginBottom: 12,
  },
  jwtInput: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    minHeight: 100,
    textAlignVertical: 'top',
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
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 20,
  },
  dividerLine: { flex: 1, height: StyleSheet.hairlineWidth },
  dividerText: { paddingHorizontal: 12, fontSize: 13 },
  error: { color: '#c62828', marginTop: 16, fontSize: 15, lineHeight: 22 },
});
