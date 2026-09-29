import { Tabs } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { palette } from '../../ui';
import type { ColorValue } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type IconName = keyof typeof MaterialCommunityIcons.glyphMap;
const icon = (name: IconName, color: ColorValue) => <MaterialCommunityIcons name={name} size={24} color={color} />;

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  return <Tabs screenOptions={{ headerShown: false, tabBarActiveTintColor: palette.forest, tabBarInactiveTintColor: palette.muted, tabBarLabelStyle: { fontSize: 12, fontWeight: '700', marginBottom: 4 }, tabBarStyle: { backgroundColor: palette.surface, borderTopColor: palette.border, height: 64 + insets.bottom, paddingTop: 6, paddingBottom: Math.max(7, insets.bottom) }, tabBarItemStyle: { minHeight: 48 } }}>
    <Tabs.Screen name="index" options={{ title: 'Oggi', tabBarIcon: ({ color }) => icon('home-outline', color) }} />
    <Tabs.Screen name="habits" options={{ title: 'Abitudini', tabBarIcon: ({ color }) => icon('notebook-outline', color) }} />
    <Tabs.Screen name="progress" options={{ title: 'Progressi', tabBarIcon: ({ color }) => icon('chart-bar', color) }} />
    <Tabs.Screen name="settings" options={{ title: 'Impostazioni', tabBarIcon: ({ color }) => icon('cog-outline', color) }} />
  </Tabs>;
}
