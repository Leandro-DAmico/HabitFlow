import { useState } from 'react';
import DateTimePicker from '@react-native-community/datetimepicker';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Platform, Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { localToday } from './domain';
import { useHabits } from './state';
import { createHabit, updateHabit } from './store';
import type { HabitData, HabitDraft, ScheduleKind } from './types';
import { Action, Body, Card, Field, Headline, palette, Pill, Screen } from './ui';

const icons = ['leaf', 'book-open-page-variant', 'walk', 'water', 'heart-outline', 'meditation', 'pencil-outline', 'dumbbell', 'sleep', 'music-note'] as const;
const colors = ['#315848', '#8A5E3C', '#376B8C', '#925E78', '#847124', '#5F6395'];
const weekdays = ['L', 'M', 'M', 'G', 'V', 'S', 'D'];

export default function HabitForm({ habit }: { habit?: HabitData }) {
  const { db, settings, refresh } = useHabits();
  const last = [...(habit?.schedules ?? [])].sort((a, b) => a.effective_from.localeCompare(b.effective_from)).at(-1);
  const [draft, setDraft] = useState<HabitDraft>({
    name: habit?.name ?? '', goal: habit?.goal ?? '', icon: habit?.icon ?? 'leaf', color: habit?.color ?? colors[0],
    start_date: habit?.start_date ?? localToday(settings?.timezone ?? 'UTC'),
    kind: last?.kind ?? 'daily', weekdays: last?.weekdays ?? [], target_per_week: last?.target_per_week ?? 3,
    timezone: last?.timezone ?? settings?.timezone ?? 'Europe/Rome',
  });
  const [showDate, setShowDate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const patch = (value: Partial<HabitDraft>) => setDraft((current) => ({ ...current, ...value }));
  const submit = async () => {
    setSaving(true);
    setError('');
    try {
      if (habit) await updateHabit(db, habit, draft);
      else await createHabit(db, draft);
      await refresh();
      router.back();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Non riesco a salvare. Riprova.'); }
    finally { setSaving(false); }
  };
  return <Screen safeTop={false} eyebrow={habit ? 'Il tuo piano' : 'Un piccolo inizio'} title={habit ? 'Modifica abitudine' : 'Nuova abitudine'} subtitle="Scegli qualcosa che possa entrare nella tua vita, anche nei giorni pieni.">
    <Card>
      <Headline>La tua idea</Headline><View style={{ height: 18 }} />
      <Field label="Nome dell’abitudine" value={draft.name} onChangeText={(name) => patch({ name })} placeholder="Es. Leggere dieci pagine" maxLength={80} autoCapitalize="sentences" />
      <Field label="Perché conta per te? (facoltativo)" value={draft.goal} onChangeText={(goal) => patch({ goal })} placeholder="Es. Regalarmi un momento di calma" maxLength={240} multiline />
      <Body muted>Icona</Body><View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 9, marginTop: 10, marginBottom: 16 }}>
        {icons.map((icon) => <Pressable key={icon} onPress={() => patch({ icon })} accessibilityRole="button" accessibilityLabel={`Icona ${icon}`} accessibilityState={{ selected: draft.icon === icon }} style={{ width: 49, height: 49, borderRadius: 16, borderWidth: draft.icon === icon ? 2 : 1, borderColor: draft.icon === icon ? palette.forest : palette.border, backgroundColor: draft.icon === icon ? palette.forestSoft : palette.white, justifyContent: 'center', alignItems: 'center' }}><MaterialCommunityIcons name={icon} size={24} color={palette.forest} /></Pressable>)}
      </View>
      <Body muted>Colore</Body><View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 10 }}>
        {colors.map((color) => <Pressable key={color} onPress={() => patch({ color })} accessibilityRole="button" accessibilityLabel={`Colore ${color}`} accessibilityState={{ selected: draft.color === color }} style={{ width: 48, height: 48, borderRadius: 16, backgroundColor: color, borderWidth: draft.color === color ? 3 : 0, borderColor: palette.ink, alignItems: 'center', justifyContent: 'center' }}>{draft.color === color && <MaterialCommunityIcons name="check" size={24} color="white" />}</Pressable>)}
      </View>
    </Card>
    <Card><Headline>Il ritmo giusto</Headline><Text style={{ color: palette.muted, marginTop: 5, marginBottom: 17, lineHeight: 21 }}>{habit ? 'Il nuovo piano entrerà in vigore dal prossimo lunedì, senza cambiare lo storico.' : 'Puoi modificare il piano più avanti, senza cambiare lo storico.'}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 18 }}>
        {([['daily', 'Ogni giorno'], ['weekdays', 'Giorni scelti'], ['times_per_week', 'N volte / settimana']] as [ScheduleKind, string][]).map(([key, label]) => <Pill key={key} title={label} selected={draft.kind === key} onPress={() => patch({ kind: key })} />)}
      </View>
      {draft.kind === 'weekdays' && <><Body muted>Scegli i giorni</Body><View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10, marginBottom: 16 }}>{weekdays.map((title, index) => <Pressable key={index} onPress={() => patch({ weekdays: draft.weekdays.includes(index + 1) ? draft.weekdays.filter((day) => day !== index + 1) : [...draft.weekdays, index + 1] })} accessibilityRole="button" accessibilityLabel={['Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato', 'Domenica'][index]} accessibilityState={{ selected: draft.weekdays.includes(index + 1) }} style={{ width: 48, height: 48, borderRadius: 13, justifyContent: 'center', alignItems: 'center', backgroundColor: draft.weekdays.includes(index + 1) ? palette.forest : palette.forestSoft }}><Text style={{ color: draft.weekdays.includes(index + 1) ? palette.white : palette.forest, fontWeight: '800' }}>{title}</Text></Pressable>)}</View></>}
      {draft.kind === 'times_per_week' && <><Body muted>Quante volte?</Body><View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 10, marginBottom: 16 }}>{[1, 2, 3, 4, 5, 6, 7].map((number) => <Pill key={number} title={String(number)} selected={draft.target_per_week === number} onPress={() => patch({ target_per_week: number })} />)}</View></>}
      <Body muted>Data di inizio</Body><Action title={draft.start_date} icon="calendar-month-outline" kind="secondary" onPress={() => setShowDate(!showDate)} style={{ marginTop: 10, marginBottom: 14 }} disabled={Boolean(habit)} />
      {showDate && !habit && <View style={{ backgroundColor: palette.white, borderRadius: 14, marginBottom: 15 }}><DateTimePicker value={new Date(Number(draft.start_date.slice(0, 4)), Number(draft.start_date.slice(5, 7)) - 1, Number(draft.start_date.slice(8, 10)), 12)} mode="date" display={Platform.OS === 'ios' ? 'inline' : 'default'} onChange={(_, value) => { if (Platform.OS === 'android') setShowDate(false); if (value) patch({ start_date: `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}` }); }} />{Platform.OS === 'ios' && <Action title="Fatto" kind="quiet" onPress={() => setShowDate(false)} />}</View>}
      <Field label="Fuso orario IANA" value={draft.timezone} onChangeText={(timezone) => patch({ timezone })} hint="Es. Europe/Rome. Le date già registrate non verranno riscritte." autoCapitalize="none" autoCorrect={false} />
    </Card>
    {error && <Text accessibilityRole="alert" style={{ color: palette.danger, marginBottom: 12 }}>{error}</Text>}
    <Action title={saving ? 'Salvataggio…' : habit ? 'Salva modifiche' : 'Crea abitudine'} icon="check" disabled={saving} onPress={() => void submit()} />
    <Action title="Annulla" kind="quiet" onPress={() => router.back()} style={{ marginTop: 8 }} />
  </Screen>;
}
