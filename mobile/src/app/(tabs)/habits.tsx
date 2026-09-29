import { useMemo, useState } from 'react';
import { router } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Pressable, Text, View } from 'react-native';
import { habitToday, scheduleAt, scheduleLabel, stats } from '../../domain';
import { useHabits } from '../../state';
import { Action, Body, Card, Empty, Field, Headline, palette, Pill, Screen } from '../../ui';
import type { HabitStatus } from '../../types';

type Filter = 'all' | HabitStatus;
export default function HabitsScreen() {
  const { habits } = useHabits();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('active');
  const filtered = useMemo(() => habits.filter((habit) => (filter === 'all' || habit.status === filter)
    && `${habit.name} ${habit.goal}`.toLocaleLowerCase('it').includes(query.toLocaleLowerCase('it').trim())), [habits, query, filter]);
  return <Screen eyebrow="I tuoi piani" title="Abitudini" subtitle="Cambia ritmo quando serve. Ogni gesto fatto resta tuo.">
    <Action title="Nuova abitudine" icon="plus" onPress={() => router.push('/new')} style={{ marginBottom: 18 }} />
    <Field label="Cerca" value={query} onChangeText={setQuery} placeholder="Nome o obiettivo" autoCorrect={false} />
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 19 }}>
      {([['active', 'Attive'], ['paused', 'In pausa'], ['archived', 'Archiviate'], ['all', 'Tutte']] as [Filter, string][]).map(([key, title]) => <Pill key={key} title={title} selected={filter === key} onPress={() => setFilter(key)} />)}
    </View>
    {filtered.length === 0 ? <Empty icon="text-box-search-outline" title="Nessun risultato" message="Prova un altro filtro o crea una nuova abitudine." /> : filtered.map((habit) => {
      const day = habitToday(habit);
      const plan = scheduleAt(habit, day) ?? habit.schedules[0];
      const progress = stats(habit, day);
      return <Pressable key={habit.id} accessibilityRole="button" accessibilityLabel={`Apri ${habit.name}`} onPress={() => router.push(`/habit/${habit.id}`)}>
        <Card>
          <View style={{ flexDirection: 'row', gap: 13, alignItems: 'center' }}>
            <View style={{ width: 46, height: 46, borderRadius: 14, backgroundColor: habit.color + '20', alignItems: 'center', justifyContent: 'center' }}><MaterialCommunityIcons name={(habit.icon || 'leaf') as keyof typeof MaterialCommunityIcons.glyphMap} size={24} color={habit.color} /></View>
            <View style={{ flex: 1 }}><Headline>{habit.name}</Headline><Body muted>{scheduleLabel(plan)}</Body></View>
            <MaterialCommunityIcons name="chevron-right" size={25} color={palette.muted} />
          </View>
          {habit.goal ? <Text style={{ color: palette.muted, fontSize: 15, marginTop: 13, lineHeight: 21 }}>{habit.goal}</Text> : null}
          <Text style={{ color: habit.status === 'active' ? palette.forest : palette.muted, fontSize: 13, fontWeight: '700', marginTop: 14 }}>{habit.status === 'active' ? `${progress.current} ${progress.unit} · miglior ${progress.best}` : habit.status === 'paused' ? 'In pausa · riprendi quando vuoi' : 'Archiviata'}</Text>
        </Card>
      </Pressable>;
    })}
  </Screen>;
}
