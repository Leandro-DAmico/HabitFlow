import { useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { addDays, eligible, habitToday, isoDay, localToday, monday, stats } from '../../domain';
import { useHabits } from '../../state';
import { Body, Card, Empty, Headline, palette, Pill, Screen } from '../../ui';

type Bucket = { label: string; done: number; available: number };
const daysBetween = (start: string, end: string) => {
  const result: string[] = [];
  for (let day = start; day <= end; day = addDays(day, 1)) result.push(day);
  return result;
};

export default function ProgressScreen() {
  const { habits, settings } = useHabits();
  const [span, setSpan] = useState(84);
  const [selection, setSelection] = useState('all');
  const chosen = selection === 'all' ? habits : habits.filter((habit) => habit.id === selection);
  const today = localToday(settings?.timezone ?? 'UTC');
  const first = addDays(today, 1 - span);
  const result = useMemo(() => {
    let completed = 0;
    let expected = 0;
    let total = 0;
    const heat: { date: string; done: number; available: number }[] = [];
    const weekly = new Map<string, Bucket>();
    const monthly = new Map<string, Bucket>();
    for (const habit of chosen) {
      const end = habitToday(habit);
      const score = stats(habit, end, first, today);
      completed += score.completed;
      expected += score.expected;
      total += score.total;
    }
    for (const date of daysBetween(first, today)) {
      let done = 0;
      let available = 0;
      for (const habit of chosen) {
        if (date > habitToday(habit)) continue;
        if (eligible(habit, date)) available++;
        if (habit.checkins.some((item) => item.occurrence_date === date)) done++;
      }
      heat.push({ date, done, available });
      const week = monday(date);
      const month = date.slice(0, 7);
      for (const [map, key] of [[weekly, week], [monthly, month]] as const) {
        const item = map.get(key) ?? { label: key, done: 0, available: 0 };
        item.done += done; item.available += available; map.set(key, item);
      }
    }
    return { completed, expected, total, heat, weekly: [...weekly.values()].slice(-12), monthly: [...monthly.values()].slice(-6) };
  }, [chosen, first, today]);
  const rate = result.expected ? Math.round(result.completed / result.expected * 100) : null;
  return <Screen eyebrow="Dati che aiutano" title="Progressi, non pressione." subtitle="La costanza si legge rispetto al piano che hai scelto.">
    <View style={{ flexDirection: 'row', gap: 8, marginBottom: 11 }}><Pill title="4 settimane" selected={span === 28} onPress={() => setSpan(28)} /><Pill title="12 settimane" selected={span === 84} onPress={() => setSpan(84)} /></View>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 }}><Pill title="Tutte" selected={selection === 'all'} onPress={() => setSelection('all')} />{habits.map((habit) => <Pill key={habit.id} title={habit.name} selected={selection === habit.id} onPress={() => setSelection(habit.id)} />)}</View>
    {habits.length === 0 ? <Empty icon="chart-bar" title="I progressi arriveranno" message="Crea un’abitudine e vedrai qui il tuo ritmo nel tempo." /> : <>
      <View style={{ flexDirection: 'row', gap: 10 }}><Card style={{ flex: 1 }}><Body muted>Costanza</Body><Text style={{ color: palette.forest, fontSize: 32, fontWeight: '800', marginTop: 9 }}>{rate === null ? '—' : `${rate}%`}</Text><Text style={{ color: palette.muted, fontSize: 12, lineHeight: 18 }}>{result.completed} su {result.expected} momenti conclusi</Text></Card><Card style={{ flex: 1 }}><Body muted>Check-in</Body><Text style={{ color: palette.forest, fontSize: 32, fontWeight: '800', marginTop: 9 }}>{result.total}</Text><Text style={{ color: palette.muted, fontSize: 12, lineHeight: 18 }}>gesti registrati</Text></Card></View>
      <Text style={{ color: palette.muted, lineHeight: 21, marginBottom: 16 }}>Un giorno o una settimana ancora aperti non sono un fallimento. La heatmap mostra gesti e occasioni; il tasso sopra usa solo obiettivi conclusi.</Text>
      <Card><Headline>Calendario</Headline><Body muted>Ultimi {span} giorni · un quadratino per giorno</Body>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 17 }}>
          {Array.from({ length: isoDay(first) - 1 }).map((_, index) => <View key={`gap-${index}`} style={{ width: '12.5%', aspectRatio: 1 }} />)}
          {result.heat.map((point) => <View key={point.date} accessible accessibilityLabel={`${point.date}: ${point.done} completamenti, ${point.available} occasioni`} style={{ width: '12.5%', aspectRatio: 1, maxHeight: 34, justifyContent: 'center', alignItems: 'center' }}><View style={{ width: 22, height: 22, borderRadius: 6, backgroundColor: point.done ? palette.forest : point.available ? '#DDE9DD' : '#F1F3EF' }} /></View>)}
        </View>
        <Body muted>Scuro: completato · chiaro: disponibile</Body>
      </Card>
      <Series title="Andamento settimanale" data={result.weekly} />
      <Series title="Andamento mensile" data={result.monthly} />
    </>}
  </Screen>;
}

function Series({ title, data }: { title: string; data: Bucket[] }) {
  const maximum = Math.max(1, ...data.map((item) => item.done));
  return <Card><Headline>{title}</Headline><Body muted>Check-in registrati, senza giudizi sul piano</Body>
    {data.every((item) => item.done === 0) ? <Body muted>Ancora nessun check-in in questo periodo.</Body> : data.map((item) => <View key={item.label} style={{ marginTop: 13, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <Text style={{ color: palette.muted, width: 75, fontSize: 12 }}>{item.label}</Text>
      <View style={{ flex: 1, height: 12, borderRadius: 6, backgroundColor: palette.forestSoft }}><View style={{ width: `${item.done / maximum * 100}%`, height: 12, borderRadius: 6, backgroundColor: palette.forest }} /></View>
      <Text style={{ color: palette.ink, width: 24, textAlign: 'right', fontWeight: '700' }}>{item.done}</Text>
    </View>)}
    <Body muted>Valori esatti indicati accanto a ogni barra.</Body>
  </Card>;
}
