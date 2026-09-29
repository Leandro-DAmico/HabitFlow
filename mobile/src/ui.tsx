import type { ReactElement, ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type RefreshControlProps, type TextInputProps, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';

export const palette = {
  paper: '#F6F6F0', surface: '#FFFDF8', ink: '#20362E', muted: '#55685D',
  forest: '#315848', forestSoft: '#E1ECE1', border: '#D7E1D5', gold: '#BD8A2B',
  danger: '#A53738', dangerSoft: '#FBE8E5', white: '#FFFFFF',
};

export function Screen({ children, title, eyebrow, subtitle, refreshControl, safeTop = true }: {
  children: ReactNode; title?: string; eyebrow?: string; subtitle?: string; refreshControl?: ReactElement<RefreshControlProps>; safeTop?: boolean;
}) {
  const insets = useSafeAreaInsets();
  return <ScrollView style={{ flex: 1, backgroundColor: palette.paper }} contentContainerStyle={{ paddingTop: (safeTop ? insets.top : 0) + 22, paddingBottom: Math.max(insets.bottom, 12) + 32, paddingHorizontal: 20, width: '100%', maxWidth: 680, alignSelf: 'center' }} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" automaticallyAdjustKeyboardInsets refreshControl={refreshControl}>
    {eyebrow && <Text style={styles.eyebrow}>{eyebrow}</Text>}
    {title && <Text style={styles.title} accessibilityRole="header">{title}</Text>}
    {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
    {children}
  </ScrollView>;
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Label({ children }: { children: ReactNode }) { return <Text style={styles.label}>{children}</Text>; }
export function Body({ children, muted = false, style }: { children: ReactNode; muted?: boolean; style?: object }) { return <Text style={[styles.body, muted && { color: palette.muted }, style]}>{children}</Text>; }
export function Headline({ children }: { children: ReactNode }) { return <Text style={styles.headline}>{children}</Text>; }

export function Action({ title, onPress, icon, kind = 'primary', disabled = false, style, accessibilityLabel }: {
  title: string; onPress: () => void; icon?: keyof typeof MaterialCommunityIcons.glyphMap;
  kind?: 'primary' | 'secondary' | 'quiet' | 'danger'; disabled?: boolean; style?: ViewStyle; accessibilityLabel?: string;
}) {
  const color = kind === 'primary' ? palette.white : kind === 'danger' ? palette.danger : palette.forest;
  return <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? title} accessibilityState={{ disabled }} style={({ pressed }) => [styles.action, kind === 'primary' ? styles.primary : kind === 'danger' ? styles.danger : kind === 'quiet' ? styles.quiet : styles.secondary, disabled && { opacity: 0.48 }, pressed && !disabled && { opacity: 0.74 }, style]}>
    {icon && <MaterialCommunityIcons name={icon} size={21} color={color} />}
    <Text style={[styles.actionText, { color }]}>{title}</Text>
  </Pressable>;
}

export function Field({ label, hint, ...props }: TextInputProps & { label: string; hint?: string }) {
  return <View style={{ marginBottom: 16 }}><Label>{label}</Label><TextInput accessibilityLabel={label} placeholderTextColor="#74857C" selectionColor={palette.forest} style={[styles.input, props.multiline && { minHeight: 88, textAlignVertical: 'top' }]} {...props} />{hint && <Text style={styles.hint}>{hint}</Text>}</View>;
}

export function Pill({ title, selected, onPress }: { title: string; selected: boolean; onPress: () => void }) {
  return <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected }} style={({ pressed }) => [styles.pill, selected && styles.pillSelected, pressed && { opacity: 0.7 }]}><Text style={[styles.pillText, selected && { color: palette.white }]}>{title}</Text></Pressable>;
}

export function Empty({ icon, title, message, action }: { icon: keyof typeof MaterialCommunityIcons.glyphMap; title: string; message: string; action?: ReactNode }) {
  return <Card style={{ alignItems: 'center', paddingVertical: 32 }}><MaterialCommunityIcons name={icon} size={34} color={palette.forest} /><Headline>{title}</Headline><Body muted style={{ textAlign: 'center', marginTop: 7 }}>{message}</Body>{action && <View style={{ marginTop: 20 }}>{action}</View>}</Card>;
}

export function Loading() { return <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: palette.paper }}><ActivityIndicator color={palette.forest} size="large" /><Body muted>Un momento…</Body></View>; }

const styles = StyleSheet.create({
  eyebrow: { color: palette.gold, fontWeight: '800', fontSize: 12, letterSpacing: 1.6, textTransform: 'uppercase', marginBottom: 7 },
  title: { color: palette.ink, fontSize: 39, lineHeight: 45, fontWeight: '700', letterSpacing: -1.5, marginBottom: 8 },
  subtitle: { color: palette.muted, fontSize: 16, lineHeight: 24, marginBottom: 25 },
  card: { backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, borderRadius: 24, padding: 20, marginBottom: 14 },
  label: { color: palette.ink, fontWeight: '700', fontSize: 15, marginBottom: 8 },
  body: { color: palette.ink, fontSize: 16, lineHeight: 23 },
  headline: { color: palette.ink, fontWeight: '700', fontSize: 22, lineHeight: 29, letterSpacing: -0.5 },
  action: { minHeight: 50, borderRadius: 16, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9 },
  primary: { backgroundColor: palette.forest },
  secondary: { backgroundColor: palette.forestSoft, borderWidth: 1, borderColor: '#BED4C3' },
  quiet: { backgroundColor: 'transparent' },
  danger: { backgroundColor: palette.dangerSoft },
  actionText: { fontSize: 16, fontWeight: '700' },
  input: { backgroundColor: palette.white, borderWidth: 1, borderColor: '#B8CABD', borderRadius: 15, paddingHorizontal: 16, paddingVertical: 13, minHeight: 52, color: palette.ink, fontSize: 16 },
  hint: { color: palette.muted, fontSize: 13, lineHeight: 19, marginTop: 5 },
  pill: { minHeight: 46, paddingHorizontal: 16, borderRadius: 24, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface, justifyContent: 'center', alignItems: 'center' },
  pillSelected: { backgroundColor: palette.forest, borderColor: palette.forest },
  pillText: { color: palette.forest, fontWeight: '700', fontSize: 14 },
});
