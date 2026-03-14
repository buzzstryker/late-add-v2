import FontAwesome from '@expo/vector-icons/FontAwesome';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import * as ScreenOrientation from 'expo-screen-orientation';
import React, { useEffect, ReactNode } from 'react';
import { View, ActivityIndicator, Platform } from 'react-native';
import 'react-native-reanimated';

import { useColorScheme } from '@/components/useColorScheme';
import { AppProvider, useApp } from '@/src/context/AppContext';
import { AuthProvider } from '@/src/context/AuthContext';
import { SyncProvider } from '@/src/context/SyncContext';
import { PlayerProvider, usePlayers } from '@/src/context/PlayerContext';
import { RoundProvider } from '@/src/context/RoundContext';
import { CourseProvider } from '@/src/context/CourseContext';
import { VoiceProvider } from '@/src/context/VoiceContext';
import { GroupProvider } from '@/src/context/GroupContext';
import { OwnerOnboarding } from '@/src/components/OwnerOnboarding';

export { ErrorBoundary } from 'expo-router';

export const unstable_settings = {
  initialRouteName: '(tabs)',
};

SplashScreen.preventAutoHideAsync();
// Lock the app to portrait by default; individual screens can override.
// iPad: allow free rotation — cart-mounted in landscape for scorecard view.
if (!Platform.isPad) {
  ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
}

export default function RootLayout() {
  const [loaded, error] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
    ...FontAwesome.font,
  });

  useEffect(() => {
    if (error) throw error;
  }, [error]);

  useEffect(() => {
    if (loaded) {
      SplashScreen.hideAsync();
    }
  }, [loaded]);

  if (!loaded) {
    return null;
  }

  return <RootLayoutNav />;
}

function OwnerGate({ children }: { children: ReactNode }) {
  const { state: appState } = useApp();
  const { ownerPlayerId, ownerLoaded } = usePlayers();

  if (!appState.isDbReady || !ownerLoaded) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#F5F5F5' }}>
        <ActivityIndicator size="large" color="#2E7D32" />
      </View>
    );
  }

  if (ownerPlayerId === null) {
    return <OwnerOnboarding />;
  }

  return <>{children}</>;
}

function RootLayoutNav() {
  const colorScheme = useColorScheme();

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <AppProvider>
        <AuthProvider>
        <SyncProvider>
        <PlayerProvider>
          <CourseProvider>
            <GroupProvider>
            <RoundProvider>
              <VoiceProvider>
              <OwnerGate>
              <Stack>
              <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
              <Stack.Screen name="round/setup" options={{ title: 'New Round', presentation: 'modal' }} />
              <Stack.Screen name="round/[id]/index" options={{ title: 'Scorecard', headerBackTitle: 'Back' }} />
              <Stack.Screen name="round/[id]/summary" options={{ title: 'Round Summary', presentation: 'modal' }} />
              <Stack.Screen name="player/add" options={{ title: 'Add Player', presentation: 'modal' }} />
              <Stack.Screen name="player/[id]" options={{ title: 'Edit Player' }} />
              <Stack.Screen name="course/search" options={{ title: 'Find Course', presentation: 'modal' }} />
              <Stack.Screen name="group/create" options={{ title: 'New Group', presentation: 'modal' }} />
              <Stack.Screen name="group/import" options={{ title: 'Import Data', presentation: 'modal' }} />
              <Stack.Screen name="group/[id]/index" options={{ title: 'Group', headerBackTitle: 'Groups' }} />
              <Stack.Screen name="group/[id]/edit" options={{ title: 'Edit Group', presentation: 'modal' }} />
              <Stack.Screen name="group/[id]/members" options={{ title: 'Members', presentation: 'modal' }} />
              <Stack.Screen name="group/[id]/season/[seasonId]/index" options={{ title: 'Standings', headerBackTitle: 'Group' }} />
              <Stack.Screen name="group/[id]/season/[seasonId]/round/[roundId]/settlement" options={{ title: 'Settlement', presentation: 'modal' }} />
              </Stack>
              </OwnerGate>
              </VoiceProvider>
            </RoundProvider>
            </GroupProvider>
          </CourseProvider>
        </PlayerProvider>
        </SyncProvider>
        </AuthProvider>
      </AppProvider>
    </ThemeProvider>
  );
}
