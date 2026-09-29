import { useState } from 'react';
import { router } from 'expo-router';
import { View, Text } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useHabits } from '../state';
import { saveSettings } from '../store';
import { Action, Card, Field, Label, palette, Screen } from '../ui';

export default function Onboarding() {
  const { db, settings, refresh } = useHabits();
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const finish = async () => {
    if (!name.trim()) { setError('Scrivi il nome con cui vuoi essere salutato.'); return; }
    if (!settings) return;
    setBusy(true);
    try {
      await saveSettings(db, { ...settings, display_name: name.trim(), onboarding_completed: true });
      await refresh();
      router.replace('/(tabs)');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Non riesco a salvare.'); }
    finally { setBusy(false); }
  };
  return <Screen eyebrow="Benvenuto in HabitFlow" title="Fai spazio a ciò che conta." subtitle="Piccoli passi, al tuo ritmo. Tutto resta sul tuo dispositivo, anche senza rete.">
    <Card style={{ paddingVertical: 28 }}>
      <MaterialCommunityIcons name="sprout-outline" size={58} color={palette.forest} style={{ marginBottom: 18 }} />
      <Field label="Come ti chiami?" value={name} onChangeText={setName} placeholder="Il tuo nome" autoCapitalize="words" autoCorrect={false} maxLength={80} returnKeyType="done" onSubmitEditing={() => void finish()} />
      <Label>Un piano che si adatta alla vita</Label>
      <Text style={{ color: palette.muted, fontSize: 15, lineHeight: 23, marginBottom: 22 }}>Sceglierai frequenza e obiettivo della prima abitudine. Potrai metterla in pausa o cambiare piano senza cancellare il passato.</Text>
      {error && <Text accessibilityRole="alert" style={{ color: palette.danger, marginBottom: 12 }}>{error}</Text>}
      <Action title={busy ? 'Salvataggio…' : 'Cominciamo'} icon="arrow-right" onPress={() => void finish()} disabled={busy} />
    </Card>
    <View style={{ paddingHorizontal: 8 }}><Text style={{ color: palette.muted, lineHeight: 21 }}>Nessun account, nessuna sincronizzazione nascosta. Esporta un backup quando vuoi dalle Impostazioni.</Text></View>
  </Screen>;
}
