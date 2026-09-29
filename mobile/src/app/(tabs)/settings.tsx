import { useState } from 'react';
import { Alert, Text, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { useHabits } from '../../state';
import { exportBackup, importBackup, saveSettings, seedDemo, validateBackup } from '../../store';
import type { Backup } from '../../types';
import { Action, Body, Card, Field, Headline, palette, Screen } from '../../ui';

export default function SettingsScreen() {
  const { db, settings, refresh } = useHabits();
  const [name, setName] = useState(settings?.display_name ?? '');
  const [timezone, setTimezone] = useState(settings?.timezone ?? 'Europe/Rome');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [preview, setPreview] = useState<Backup | null>(null);
  const run = async (operation: () => Promise<void>) => {
    setBusy(true); setNotice('');
    try { await operation(); }
    catch (cause) { setNotice(cause instanceof Error ? cause.message : 'Operazione non riuscita.'); }
    finally { setBusy(false); }
  };
  const save = () => void run(async () => {
    if (!settings) return;
    if (!name.trim()) throw new Error('Il nome non può essere vuoto.');
    try { new Intl.DateTimeFormat('it-IT', { timeZone: timezone }); } catch { throw new Error('Fuso orario IANA non valido.'); }
    await saveSettings(db, { ...settings, display_name: name, timezone });
    await refresh(); setNotice('Preferenze salvate.');
  });
  const exportFile = () => void run(async () => {
    const backup = await exportBackup(db);
    const file = new File(Paths.cache, `habitflow-backup-${new Date().toISOString().slice(0, 10)}.json`);
    file.create({ overwrite: true });
    file.write(JSON.stringify(backup, null, 2));
    if (!(await Sharing.isAvailableAsync())) throw new Error('Condivisione file non disponibile sul dispositivo.');
    await Sharing.shareAsync(file.uri, { mimeType: 'application/json', dialogTitle: 'Salva il backup HabitFlow', UTI: 'public.json' });
    setNotice('Scegli dove salvare il backup nella schermata di condivisione.');
  });
  const chooseFile = () => void run(async () => {
    const selected = await DocumentPicker.getDocumentAsync({ type: 'application/json', copyToCacheDirectory: true });
    if (selected.canceled) return;
    const asset = selected.assets[0];
    if (asset.size && asset.size > 5 * 1024 * 1024) throw new Error('Il backup supera 5 MB.');
    const file = new File(asset.uri);
    if (file.size > 5 * 1024 * 1024) throw new Error('Il backup supera 5 MB.');
    const raw = await file.text();
    setPreview(validateBackup(JSON.parse(raw) as unknown));
  });
  const restore = () => void run(async () => {
    if (!preview) return;
    const outcome = await importBackup(db, preview);
    await refresh(); setPreview(null);
    setNotice(`${outcome.imported} abitudini importate, ${outcome.skipped} già presenti. Le abitudini esistenti non sono state sovrascritte.`);
  });
  const demo = () => Alert.alert('Aggiungere dati demo?', 'Tre abitudini sintetiche verranno aggiunte senza cancellare le tue.', [
    { text: 'Annulla', style: 'cancel' },
    { text: 'Aggiungi demo', onPress: () => void run(async () => { const count = await seedDemo(db); await refresh(); setNotice(count ? `${count} abitudini demo aggiunte.` : 'I dati demo sono già presenti.'); }) },
  ]);
  return <Screen eyebrow="Solo sul tuo dispositivo" title="Impostazioni" subtitle="Le tue informazioni appartengono a te. Conserva una copia quando cambi telefono.">
    {notice && <Text accessibilityRole="alert" style={{ color: palette.forest, backgroundColor: palette.forestSoft, padding: 14, borderRadius: 14, marginBottom: 15 }}>{notice}</Text>}
    <Card><Headline>Preferenze</Headline><View style={{ height: 18 }} /><Field label="Il tuo nome" value={name} onChangeText={setName} maxLength={80} /><Field label="Fuso orario IANA" value={timezone} onChangeText={setTimezone} autoCapitalize="none" autoCorrect={false} hint="Es. Europe/Rome. I check-in passati conservano le date originali." /><Action title="Salva preferenze" icon="content-save-outline" disabled={busy} onPress={save} /></Card>
    <Card><Headline>Backup e trasferimento</Headline><Body muted>Esporta un file JSON e conservalo in un luogo sicuro. Puoi importare anche il backup della versione web.</Body><View style={{ height: 17 }} /><Action title="Esporta backup JSON" icon="export-variant" kind="secondary" disabled={busy} onPress={exportFile} /><View style={{ height: 10 }} /><Action title="Importa backup JSON" icon="import" kind="secondary" disabled={busy} onPress={chooseFile} />
      {preview && <View style={{ marginTop: 17, borderRadius: 15, backgroundColor: palette.forestSoft, padding: 17 }}><Text style={{ color: palette.ink, fontWeight: '700', fontSize: 16 }}>Anteprima importazione</Text><Body>{preview.habits.length} abitudini · {preview.checkins.length} check-in</Body><Body muted>Le abitudini con lo stesso ID verranno saltate. Nessun dato esistente sarà sovrascritto.</Body><Action title="Conferma importazione" onPress={restore} disabled={busy} style={{ marginTop: 13 }} /><Action title="Annulla" kind="quiet" onPress={() => setPreview(null)} /></View>}
    </Card>
    <Card><Headline>Esplora la demo</Headline><Body muted>Dati sintetici per vedere grafici e calendario. Non sostituiscono le tue abitudini.</Body><Action title="Aggiungi dati demo" icon="flask-outline" kind="secondary" disabled={busy} onPress={demo} style={{ marginTop: 16 }} /></Card>
    <Body muted>HabitFlow salva tutto in un archivio SQLite privato dell’app. Disinstallare l’app elimina i dati locali: esporta prima un backup.</Body>
  </Screen>;
}
