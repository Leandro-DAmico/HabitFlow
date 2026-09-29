import { useMemo, useState } from 'react';
import { router } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { RefreshControl, Text, View, Pressable } from 'react-native';
import { habitToday, isDue, scheduleAt, scheduleLabel, stats } from '../../domain';
import { useHabits } from '../../state';
import { toggleCheckin } from '../../store';
import type { HabitData } from '../../types';
import { Action, Body, Card, Empty, Headline, palette, Screen } from '../../ui';

function TodayCard({ habit, onChange, onNotice }: { habit: HabitData; onChange: () => Promise<void>; onNotice: (text: string) => void }) {
  const [busy, setBusy] = useState(false);
  const { db } = useHabits();
  const day = habitToday(habit);
  const checked = habit.checkins.some((item) => item.occurrence_date === day);
  const due = isDue(habit);
  const current = stats(habit, day);
  const schedule = scheduleAt(habit, day) ?? habit.schedules[0];
  const complete = async () => {
    setBusy(true);
    try {
      const next = await toggleCheckin(db, habit);
      await Haptics.selectionAsync().catch(() => {});
      await onChange();
      onNotice(next ? 'Un momento fatto. Basta così, se vuoi.' : 'Completamento annullato.');
    } catch (cause) { onNotice(cause instanceof Error ? cause.message : 'Riprova.'); }
    finally { setBusy(false); }
  };
  return <Card style={{ backgroundColor: checked ? '#F0F8EF' : palette.surface }}>
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 13 }}>
      <View style={{ width: 48, height: 48, borderRadius: 16, backgroundColor: habit.color + '20', alignItems: 'center', justifyContent: 'center' }}>
        <MaterialCommunityIcons name={(habit.icon || 'leaf') as keyof typeof MaterialCommunityIcons.glyphMap} size={25} color={habit.color} />
      </View>
      <View style={{ flex: 1 }}>
        <Pressable accessibilityRole="button" accessibilityLabel={`Dettagli di ${habit.name}`} onPress={() => router.push(`/habit/${habit.id}`)} style={{ minHeight: 46, justifyContent: 'center' }}>
          <Text style={{ fontWeight: '800', fontSize: 19, color: palette.ink }}>{habit.name}</Text>
        </Pressable>
        {habit.goal ? <Body muted>{habit.goal}</Body> : null}
        <Text style={{ color: palette.muted, fontSize: 14, marginTop: 9 }}>{scheduleLabel(schedule)}</Text>
      </View>
    </View>
    <View style={{ marginTop: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
      <Text style={{ color: palette.muted, fontSize: 13 }}>{current.weekCompleted}/{current.weekTarget} questa settimana · {current.current} {current.unit}</Text>
      {checked && <MaterialCommunityIcons name="check-circle" size={22} color={palette.forest} />}
    </View>
    {(due || checked) && <Action title={busy ? 'Un momento…' : checked ? 'Annulla' : 'Segna come fatto'} icon={checked ? 'undo' : 'check'} kind={checked ? 'secondary' : 'primary'} disabled={busy} onPress={() => void complete()} style={{ marginTop: 17 }} accessibilityLabel={`${checked ? 'Annulla' : 'Completa'} ${habit.name}`} />}
    {!due && !checked && <Text style={{ marginTop: 13, color: palette.muted }}>Oggi non è previsto dal tuo piano.</Text>}
  </Card>;
}

export default function TodayScreen() {
  const { settings, habits, refresh } = useHabits();
  const [notice, setNotice] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const active = habits.filter((habit) => habit.status === 'active');
  const relevant = active.filter((habit) => {
    const day = habitToday(habit);
    return isDue(habit) || habit.checkins.some((item) => item.occurrence_date === day);
  });
  const done = relevant.filter((habit) => habit.checkins.some((item) => item.occurrence_date === habitToday(habit))).length;
  const date = useMemo(() => new Intl.DateTimeFormat('it-IT', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date()), []);
  const pull = async () => { setRefreshing(true); await refresh(); setRefreshing(false); };
  return <Screen eyebrow={date} title={`Buongiorno${settings?.display_name ? `, ${settings.display_name}` : ''}.`} subtitle="Piccoli passi al tuo ritmo." refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void pull()} colors={[palette.forest]} />}>
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
      <View><Text style={{ fontSize: 38, fontWeight: '800', color: palette.forest }}>{done}/{relevant.length}</Text><Body muted>momenti di oggi</Body></View>
      <Pressable accessibilityRole="button" accessibilityLabel="Crea una nuova abitudine" onPress={() => router.push('/new')} style={{ width: 54, height: 54, borderRadius: 18, backgroundColor: palette.forest, alignItems: 'center', justifyContent: 'center' }}><MaterialCommunityIcons name="plus" size={30} color="white" /></Pressable>
    </View>
    {notice ? <Text accessibilityRole="alert" style={{ backgroundColor: palette.forestSoft, color: palette.forest, padding: 14, borderRadius: 14, marginBottom: 16 }}>{notice}</Text> : null}
    {active.length === 0 ? <Empty icon="sprout-outline" title="Inizia con un passo" message="Scegli un’abitudine piccola e realistica. Il ritmo lo decidi tu." action={<Action title="Crea la prima abitudine" onPress={() => router.push('/new')} />} /> : relevant.length === 0 ? <Empty icon="weather-sunny" title="Oggi puoi riposare" message="Nessun gesto previsto dal tuo piano. Ci vediamo al prossimo giorno disponibile." /> : <>
      <Headline>Il tuo ritmo</Headline><View style={{ height: 12 }} />
      {relevant.map((habit) => <TodayCard key={habit.id} habit={habit} onChange={refresh} onNotice={setNotice} />)}
    </>}
    {active.length > relevant.length && <Text style={{ color: palette.muted, marginTop: 4, lineHeight: 21 }}>{active.length - relevant.length} {active.length - relevant.length === 1 ? 'abitudine' : 'abitudini'} in programma in altri giorni.</Text>}
  </Screen>;
}
