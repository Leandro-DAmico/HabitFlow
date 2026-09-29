import { useState } from 'react';
import { useLocalSearchParams, router } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Alert, Pressable, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { habitToday, isDue, monthGrid, scheduleAt, scheduleLabel, stats } from '../../domain';
import { useHabits } from '../../state';
import { deleteHabit, saveNote, setStatus, toggleCheckin } from '../../store';
import { Action, Body, Card, Empty, Field, Headline, palette, Screen } from '../../ui';

export default function HabitDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { db, habits, refresh } = useHabits();
  const habit = habits.find((item) => item.id === id);
  const today = habit ? habitToday(habit) : '';
  const [month, setMonth] = useState(() => new Date());
  const [noteDraft, setNoteDraft] = useState<{ id: string; value: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const checkin = habit?.checkins.find((item) => item.occurrence_date === today);
  const note = noteDraft && checkin && noteDraft.id === checkin.id ? noteDraft.value : checkin?.note ?? '';
  if (!habit) return <Screen><Empty icon="alert-circle-outline" title="Abitudine non trovata" message="Torna all’elenco e riprova." /></Screen>;
  const score = stats(habit, today);
  const schedule = scheduleAt(habit, today) ?? habit.schedules[0];
  const pending = habit.schedules.find((item) => item.effective_from > today);
  const act = async (operation: () => Promise<unknown>, message: string) => {
    setBusy(true);
    try { await operation(); await refresh(); setNotice(message); }
    catch (cause) { setNotice(cause instanceof Error ? cause.message : 'Riprova.'); }
    finally { setBusy(false); }
  };
  const shift = (offset: number) => setMonth(new Date(month.getFullYear(), month.getMonth() + offset, 1));
  const cells = monthGrid(habit, month.getFullYear(), month.getMonth(), today);
  const confirmDelete = () => Alert.alert('Eliminare questa abitudine?', 'Completamenti e note verranno eliminati definitivamente. Esporta prima un backup se vuoi conservarli.', [
    { text: 'Annulla', style: 'cancel' },
    { text: 'Elimina', style: 'destructive', onPress: () => void act(async () => { await deleteHabit(db, habit.id); router.back(); }, 'Abitudine eliminata.') },
  ]);
  return <Screen safeTop={false} eyebrow="Il tuo percorso" title={habit.name} subtitle={habit.goal || 'Un gesto alla volta, senza pressione.'}>
    {notice && <Text accessibilityRole="alert" style={{ color: palette.forest, backgroundColor: palette.forestSoft, padding: 14, borderRadius: 14, marginBottom: 14 }}>{notice}</Text>}
    <Card>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}><MaterialCommunityIcons name={(habit.icon || 'leaf') as keyof typeof MaterialCommunityIcons.glyphMap} color={habit.color} size={31} /><View style={{ flex: 1 }}><Headline>{habit.status === 'active' ? 'Il piano attuale' : habit.status === 'paused' ? 'In pausa' : 'Archiviata'}</Headline><Body muted>{scheduleLabel(schedule)}</Body></View></View>
      <Text style={{ color: palette.muted, marginTop: 12, lineHeight: 21 }}>{score.weekCompleted}/{score.weekTarget} questa settimana · {score.current} {score.unit} di seguito · record {score.best}</Text>
      {pending && <Text style={{ color: palette.forest, marginTop: 9, lineHeight: 21 }}>Dal {pending.effective_from}: {scheduleLabel(pending)}. La modifica del piano non cambia i check-in passati.</Text>}
    </Card>
    {habit.status === 'active' && <Card><Headline>Oggi</Headline><Body muted>{checkin ? 'Questo momento è registrato.' : isDue(habit) ? 'Un piccolo passo è disponibile.' : 'Oggi è un giorno libero dal piano.'}</Body>
      {(checkin || isDue(habit)) && <Action title={busy ? 'Un momento…' : checkin ? 'Annulla completamento' : 'Segna come fatto'} kind={checkin ? 'secondary' : 'primary'} icon={checkin ? 'undo' : 'check'} disabled={busy} onPress={() => void act(async () => { await toggleCheckin(db, habit); await Haptics.selectionAsync().catch(() => {}); }, checkin ? 'Completamento annullato.' : 'Hai fatto il tuo gesto.')} style={{ marginTop: 15 }} />}
      {checkin && <View style={{ marginTop: 20 }}><Field label="Nota di oggi (facoltativa)" value={note} onChangeText={(value) => setNoteDraft({ id: checkin.id, value })} maxLength={1000} multiline placeholder="Com’è andata?" /><Action title="Salva nota" kind="secondary" disabled={busy || note === checkin.note} onPress={() => void act(() => saveNote(db, habit, note), 'Nota salvata.')} /></View>}
    </Card>}
    <Card><View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}><Pressable accessibilityRole="button" accessibilityLabel="Mese precedente" onPress={() => shift(-1)} style={{ padding: 10, minWidth: 48 }}><MaterialCommunityIcons name="chevron-left" size={27} color={palette.forest} /></Pressable><Headline>{new Intl.DateTimeFormat('it-IT', { month: 'long', year: 'numeric' }).format(month)}</Headline><Pressable accessibilityRole="button" accessibilityLabel="Mese successivo" onPress={() => shift(1)} style={{ padding: 10, minWidth: 48 }}><MaterialCommunityIcons name="chevron-right" size={27} color={palette.forest} /></Pressable></View>
      <View style={{ flexDirection: 'row', marginTop: 17 }}>{['L', 'M', 'M', 'G', 'V', 'S', 'D'].map((day, index) => <Text key={index} style={{ flex: 1, textAlign: 'center', color: palette.muted, fontWeight: '700' }}>{day}</Text>)}</View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 8 }}>{cells.map((cell, index) => <View key={cell.date || `gap-${index}`} accessible={Boolean(cell.date)} accessibilityLabel={cell.date ? `${cell.date}: ${cell.completed ? 'completato' : cell.planned ? 'disponibile' : cell.future ? 'futuro' : 'riposo'}` : undefined} style={{ width: '14.285%', height: 45, alignItems: 'center', justifyContent: 'center' }}><View style={{ width: 37, height: 37, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: cell.completed ? palette.forest : cell.planned ? palette.forestSoft : 'transparent' }}><Text style={{ color: cell.completed ? palette.white : cell.planned ? palette.forest : palette.muted, fontWeight: cell.completed ? '800' : '500' }}>{cell.date ? Number(cell.date.slice(-2)) : ''}</Text></View></View>)}</View>
      <Body muted>Scuro: fatto · chiaro: disponibile · nessun colore: riposo</Body>
    </Card>
    <Card><Headline>Gestisci</Headline><View style={{ height: 16 }} />
      {habit.status !== 'archived' && <Action title="Modifica piano" icon="pencil-outline" kind="secondary" onPress={() => router.push({ pathname: '/habit/edit', params: { id: habit.id } })} style={{ marginBottom: 10 }} />}
      {habit.status === 'active' && <Action title="Metti in pausa" icon="pause-circle-outline" kind="quiet" onPress={() => void act(() => setStatus(db, habit, 'pause'), 'Puoi riprendere quando vuoi.')} disabled={busy} />}
      {habit.status === 'paused' && <Action title="Riprendi senza recuperi" icon="play-circle-outline" kind="primary" onPress={() => void act(() => setStatus(db, habit, 'resume'), 'Bentornato. Si riparte da oggi.')} disabled={busy} />}
      {habit.status !== 'archived' && <Action title="Archivia" icon="archive-outline" kind="quiet" onPress={() => Alert.alert('Archiviare?', 'Lo storico resta disponibile. Potrai ripristinare questa abitudine.', [{ text: 'Annulla', style: 'cancel' }, { text: 'Archivia', onPress: () => void act(() => setStatus(db, habit, 'archive'), 'Abitudine archiviata.') }])} disabled={busy} />}
      {habit.status === 'archived' && <Action title="Ripristina" icon="restore" kind="secondary" onPress={() => void act(() => setStatus(db, habit, 'restore'), 'Bentornato. Nessun recupero richiesto.')} disabled={busy} />}
      <Action title="Elimina definitivamente" icon="delete-outline" kind="danger" onPress={confirmDelete} disabled={busy} style={{ marginTop: 18 }} />
    </Card>
  </Screen>;
}
