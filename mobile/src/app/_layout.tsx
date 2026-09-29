import { Stack } from 'expo-router';
import { SQLiteProvider } from 'expo-sqlite';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { HabitProvider } from '../state';
import { migrate } from '../store';
import { palette } from '../ui';

export default function RootLayout() {
  return <SafeAreaProvider>
    <SQLiteProvider databaseName="habitflow.db" onInit={migrate}>
      <HabitProvider>
        <StatusBar style="dark" />
        <Stack screenOptions={{ headerStyle: { backgroundColor: palette.paper }, headerTintColor: palette.ink, headerShadowVisible: false, contentStyle: { backgroundColor: palette.paper } }}>
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen name="onboarding" options={{ headerShown: false }} />
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="new" options={{ title: 'Nuova abitudine', presentation: 'modal' }} />
          <Stack.Screen name="habit/[id]" options={{ title: 'La tua abitudine' }} />
          <Stack.Screen name="habit/edit" options={{ title: 'Modifica abitudine', presentation: 'modal' }} />
        </Stack>
      </HabitProvider>
    </SQLiteProvider>
  </SafeAreaProvider>;
}
