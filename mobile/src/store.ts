import * as Crypto from 'expo-crypto';
import type { SQLiteDatabase } from 'expo-sqlite';
import { eligible, habitToday, localToday, nextMonday, scheduleAt } from './domain';
import type { Backup, Checkin, Habit, HabitData, HabitDraft, Pause, Schedule, Settings } from './types';

const id = () => Crypto.randomUUID();
const timestamp = () => new Date().toISOString();

type HabitRow = Omit<Habit, 'status'> & { status: Habit['status'] };
type ScheduleRow = Omit<Schedule, 'weekdays'> & { weekdays: string };
type SettingsRow = { display_name: string; timezone: string; onboarding_completed: number };

export async function migrate(db: SQLiteDatabase) {
  await db.execAsync('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
  const version = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  if ((version?.user_version ?? 0) >= 1) return;
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY CHECK (id = 1), display_name TEXT NOT NULL,
      timezone TEXT NOT NULL, onboarding_completed INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS habits (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, goal TEXT NOT NULL DEFAULT '',
      icon TEXT NOT NULL, color TEXT NOT NULL, start_date TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('active','paused','archived')),
      archived_on TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS schedules (
      id TEXT PRIMARY KEY, habit_id TEXT NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('daily','weekdays','times_per_week')),
      weekdays TEXT NOT NULL, target_per_week INTEGER NOT NULL,
      timezone TEXT NOT NULL, effective_from TEXT NOT NULL, created_at TEXT NOT NULL,
      UNIQUE (habit_id, effective_from)
    );
    CREATE TABLE IF NOT EXISTS pauses (
      id TEXT PRIMARY KEY, habit_id TEXT NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
      start_date TEXT NOT NULL, end_date TEXT, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS checkins (
      id TEXT PRIMARY KEY, habit_id TEXT NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
      schedule_id TEXT NOT NULL REFERENCES schedules(id), occurrence_date TEXT NOT NULL,
      completed_at TEXT NOT NULL, timezone TEXT NOT NULL, note TEXT NOT NULL DEFAULT '',
      UNIQUE (habit_id, occurrence_date)
    );
    CREATE INDEX IF NOT EXISTS checkins_date_idx ON checkins(occurrence_date);
    PRAGMA user_version = 1;
  `);
  await db.runAsync(
    'INSERT OR IGNORE INTO settings(id, display_name, timezone, onboarding_completed) VALUES (1, ?, ?, 0)',
    '', Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Rome',
  );
}

export async function readSettings(db: SQLiteDatabase): Promise<Settings> {
  const row = await db.getFirstAsync<SettingsRow>('SELECT display_name, timezone, onboarding_completed FROM settings WHERE id=1');
  if (!row) throw new Error('Archivio locale non inizializzato.');
  return { ...row, onboarding_completed: Boolean(row.onboarding_completed) };
}

export async function saveSettings(db: SQLiteDatabase, value: Settings) {
  await db.runAsync(
    'UPDATE settings SET display_name=?, timezone=?, onboarding_completed=? WHERE id=1',
    value.display_name.trim().slice(0, 80), value.timezone, Number(value.onboarding_completed),
  );
}

export async function readHabits(db: SQLiteDatabase): Promise<HabitData[]> {
  const [habits, schedules, pauses, checkins] = await Promise.all([
    db.getAllAsync<HabitRow>('SELECT * FROM habits ORDER BY created_at DESC'),
    db.getAllAsync<ScheduleRow>('SELECT * FROM schedules ORDER BY effective_from'),
    db.getAllAsync<Pause>('SELECT * FROM pauses ORDER BY start_date'),
    db.getAllAsync<Checkin>('SELECT * FROM checkins ORDER BY occurrence_date'),
  ]);
  return habits.map((habit) => ({
    ...habit,
    schedules: schedules.filter((item) => item.habit_id === habit.id).map((item) => ({ ...item, weekdays: JSON.parse(item.weekdays) as number[] })),
    pauses: pauses.filter((item) => item.habit_id === habit.id),
    checkins: checkins.filter((item) => item.habit_id === habit.id),
  }));
}

function validateDraft(draft: HabitDraft) {
  if (!draft.name.trim() || draft.name.trim().length > 80) throw new Error('Scegli un nome di massimo 80 caratteri.');
  if (draft.goal.length > 240) throw new Error('Obiettivo troppo lungo.');
  if (!validDay(draft.start_date)) throw new Error('Data di inizio non valida.');
  if (draft.kind === 'weekdays' && draft.weekdays.length === 0) throw new Error('Seleziona almeno un giorno.');
  if (draft.kind === 'times_per_week' && (draft.target_per_week < 1 || draft.target_per_week > 7)) throw new Error('Scegli da 1 a 7 volte a settimana.');
  try { new Intl.DateTimeFormat('it-IT', { timeZone: draft.timezone }); } catch { throw new Error('Fuso orario non valido.'); }
}

export async function createHabit(db: SQLiteDatabase, draft: HabitDraft) {
  validateDraft(draft);
  const habitId = id();
  const created = timestamp();
  await db.withExclusiveTransactionAsync(async (tx) => {
    await tx.runAsync(
      'INSERT INTO habits VALUES (?,?,?,?,?,?,?,?,?,?)',
      habitId, draft.name.trim(), draft.goal.trim(), draft.icon, draft.color,
      draft.start_date, 'active', null, created, created,
    );
    await tx.runAsync(
      'INSERT INTO schedules VALUES (?,?,?,?,?,?,?,?)',
      id(), habitId, draft.kind, JSON.stringify(draft.kind === 'weekdays' ? [...draft.weekdays].sort() : []),
      draft.kind === 'times_per_week' ? draft.target_per_week : 1,
      draft.timezone, draft.start_date, created,
    );
  });
  return habitId;
}

export async function updateHabit(db: SQLiteDatabase, habit: HabitData, draft: HabitDraft) {
  validateDraft(draft);
  const plan = [...habit.schedules].sort((a, b) => a.effective_from.localeCompare(b.effective_from)).at(-1);
  if (!plan) throw new Error('Piano non trovato.');
  const changed = plan.kind !== draft.kind || plan.target_per_week !== (draft.kind === 'times_per_week' ? draft.target_per_week : 1)
    || plan.timezone !== draft.timezone || JSON.stringify(plan.weekdays) !== JSON.stringify(draft.kind === 'weekdays' ? [...draft.weekdays].sort() : []);
  const now = timestamp();
  const today = habitToday(habit);
  const effective = nextMonday(today);
  await db.withExclusiveTransactionAsync(async (tx) => {
    await tx.runAsync('UPDATE habits SET name=?, goal=?, icon=?, color=?, updated_at=? WHERE id=?',
      draft.name.trim(), draft.goal.trim(), draft.icon, draft.color, now, habit.id);
    if (changed) {
      await tx.runAsync('DELETE FROM schedules WHERE habit_id=? AND effective_from>? AND NOT EXISTS (SELECT 1 FROM checkins WHERE schedule_id=schedules.id)', habit.id, today);
      await tx.runAsync('INSERT INTO schedules VALUES (?,?,?,?,?,?,?,?)',
        id(), habit.id, draft.kind, JSON.stringify(draft.kind === 'weekdays' ? [...draft.weekdays].sort() : []),
        draft.kind === 'times_per_week' ? draft.target_per_week : 1, draft.timezone, effective, now);
    }
  });
}

export async function toggleCheckin(db: SQLiteDatabase, habit: HabitData, note = '') {
  const day = habitToday(habit);
  if (habit.status !== 'active') throw new Error('Riprendi l’abitudine per completarla.');
  const existing = habit.checkins.find((item) => item.occurrence_date === day);
  if (existing) {
    await db.runAsync('DELETE FROM checkins WHERE id=?', existing.id);
    return false;
  }
  if (!eligible(habit, day)) throw new Error('Oggi non è previsto dal piano.');
  const schedule = scheduleAt(habit, day);
  if (!schedule) throw new Error('Piano non trovato.');
  await db.runAsync('INSERT OR IGNORE INTO checkins VALUES (?,?,?,?,?,?,?)',
    id(), habit.id, schedule.id, day, timestamp(), schedule.timezone, note.slice(0, 1000));
  return true;
}

export async function saveNote(db: SQLiteDatabase, habit: HabitData, note: string) {
  const day = habitToday(habit);
  const checkin = habit.checkins.find((item) => item.occurrence_date === day);
  if (!checkin) throw new Error('Completa prima questa abitudine.');
  await db.runAsync('UPDATE checkins SET note=? WHERE id=?', note.slice(0, 1000), checkin.id);
}

export async function setStatus(db: SQLiteDatabase, habit: HabitData, action: 'pause' | 'resume' | 'archive' | 'restore') {
  const day = habitToday(habit);
  const now = timestamp();
  await db.withExclusiveTransactionAsync(async (tx) => {
    if (action === 'pause' && habit.status === 'active') {
      await tx.runAsync('INSERT INTO pauses VALUES (?,?,?,?,?)', id(), habit.id, day, null, now);
      await tx.runAsync('UPDATE habits SET status=?, updated_at=? WHERE id=?', 'paused', now, habit.id);
    } else if (action === 'archive' && habit.status !== 'archived') {
      if (habit.status === 'active') await tx.runAsync('INSERT INTO pauses VALUES (?,?,?,?,?)', id(), habit.id, day, null, now);
      await tx.runAsync('UPDATE habits SET status=?, archived_on=?, updated_at=? WHERE id=?', 'archived', day, now, habit.id);
    } else if ((action === 'resume' && habit.status === 'paused') || (action === 'restore' && habit.status === 'archived')) {
      const open = habit.pauses.find((pause) => pause.end_date === null);
      if (open) {
        if (open.start_date === day) await tx.runAsync('DELETE FROM pauses WHERE id=?', open.id);
        else await tx.runAsync('UPDATE pauses SET end_date=? WHERE id=?', day, open.id);
      }
      await tx.runAsync('UPDATE habits SET status=?, archived_on=NULL, updated_at=? WHERE id=?', 'active', now, habit.id);
    }
  });
}

export async function deleteHabit(db: SQLiteDatabase, habitId: string) {
  await db.runAsync('DELETE FROM habits WHERE id=?', habitId);
}

export async function exportBackup(db: SQLiteDatabase): Promise<Backup> {
  const settings = await readSettings(db);
  const habits = await readHabits(db);
  return {
    format: 'habitflow-backup', version: 1, exported_at: timestamp(), settings,
    habits: habits.map(({ schedules: _schedules, pauses: _pauses, checkins: _checkins, ...habit }) => habit),
    schedules: habits.flatMap((habit) => habit.schedules),
    pauses: habits.flatMap((habit) => habit.pauses),
    checkins: habits.flatMap((habit) => habit.checkins),
  };
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const dayPattern = /^\d{4}-\d{2}-\d{2}$/;
const validDay = (value: unknown): value is string => typeof value === 'string' && dayPattern.test(value)
  && !Number.isNaN(Date.parse(`${value}T12:00:00Z`))
  && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
const validZone = (value: unknown) => {
  if (typeof value !== 'string' || !value || value.length > 64) return false;
  try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; } catch { return false; }
};

export function validateBackup(value: unknown): Backup {
  if (!value || typeof value !== 'object') throw new Error('Il file non contiene un backup JSON.');
  const data = value as Partial<Backup>;
  if (data.format !== 'habitflow-backup' || data.version !== 1 || !data.settings || !Array.isArray(data.habits)
    || !Array.isArray(data.schedules) || !Array.isArray(data.pauses) || !Array.isArray(data.checkins)) {
    throw new Error('Formato backup o versione non supportati.');
  }
  if (data.habits.length + data.schedules.length + data.pauses.length + data.checkins.length > 50_000) throw new Error('Backup troppo grande.');
  if (typeof data.settings.display_name !== 'string' || data.settings.display_name.length > 80
    || !validZone(data.settings.timezone) || typeof data.settings.onboarding_completed !== 'boolean') throw new Error('Preferenze non valide nel backup.');
  const ids = new Set<string>();
  for (const entry of [...data.habits, ...data.schedules, ...data.pauses, ...data.checkins]) {
    if (!entry || typeof entry.id !== 'string' || !uuid.test(entry.id) || ids.has(entry.id)) throw new Error('ID duplicato o non valido nel backup.');
    ids.add(entry.id);
  }
  const schedules = new Map(data.schedules.map((item) => [item.id, item]));
  const uniqueDates = new Set<string>();
  for (const item of data.habits) {
    if (!validDay(item.start_date) || !['active', 'paused', 'archived'].includes(item.status)
      || typeof item.name !== 'string' || !item.name.trim() || item.name.length > 80
      || typeof item.goal !== 'string' || item.goal.length > 240
      || typeof item.icon !== 'string' || !item.icon || item.icon.length > 32
      || typeof item.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(item.color)
      || (item.status === 'archived' && !validDay(item.archived_on))
      || (item.status !== 'archived' && item.archived_on !== null)) throw new Error('Abitudine non valida nel backup.');
  }
  for (const item of data.schedules) {
    const key = `${item.habit_id}:${item.effective_from}`;
    const habit = data.habits.find((entry) => entry.id === item.habit_id);
    if (!habit || !validDay(item.effective_from) || item.effective_from < habit.start_date || uniqueDates.has(key)
      || !['daily', 'weekdays', 'times_per_week'].includes(item.kind) || !Array.isArray(item.weekdays)
      || !Number.isInteger(item.target_per_week) || item.target_per_week < 1 || item.target_per_week > 7
      || !validZone(item.timezone) || item.weekdays.some((day) => !Number.isInteger(day) || day < 1 || day > 7)
      || new Set(item.weekdays).size !== item.weekdays.length
      || (item.kind === 'weekdays' && (!item.weekdays.length || item.target_per_week !== 1))
      || (item.kind !== 'weekdays' && item.weekdays.length > 0)
      || (item.kind === 'daily' && item.target_per_week !== 1)) throw new Error('Piano non valido nel backup.');
    uniqueDates.add(key);
  }
  for (const habit of data.habits) {
    const plans = data.schedules.filter((item) => item.habit_id === habit.id).sort((a, b) => a.effective_from.localeCompare(b.effective_from));
    if (!plans.length || plans[0].effective_from !== habit.start_date || plans.slice(1).some((item) => new Date(`${item.effective_from}T12:00:00Z`).getUTCDay() !== 1)) throw new Error('Revisioni del piano non valide nel backup.');
  }
  for (const item of data.pauses) {
    const habit = data.habits.find((entry) => entry.id === item.habit_id);
    if (!habit || !validDay(item.start_date) || item.start_date < habit.start_date || (item.end_date !== null && (!validDay(item.end_date) || item.end_date <= item.start_date))) throw new Error('Pausa non valida nel backup.');
  }
  for (const habit of data.habits) {
    const intervals = data.pauses.filter((item) => item.habit_id === habit.id).sort((a, b) => a.start_date.localeCompare(b.start_date));
    const open = intervals.filter((item) => item.end_date === null).length;
    if ((habit.status === 'active' && open !== 0) || (habit.status !== 'active' && open !== 1)
      || intervals.some((item, index) => index > 0 && (!intervals[index - 1].end_date || item.start_date < intervals[index - 1].end_date!))) throw new Error('Stato e pause incoerenti nel backup.');
  }
  const dates = new Set<string>();
  for (const item of data.checkins) {
    const key = `${item.habit_id}:${item.occurrence_date}`;
    const habit = data.habits.find((entry) => entry.id === item.habit_id);
    const plan = schedules.get(item.schedule_id);
    const active = data.schedules.filter((entry) => entry.habit_id === item.habit_id && entry.effective_from <= item.occurrence_date)
      .sort((a, b) => a.effective_from.localeCompare(b.effective_from)).at(-1);
    if (!habit || !plan || plan.habit_id !== item.habit_id || !validDay(item.occurrence_date)
      || item.occurrence_date < habit.start_date || active?.id !== plan.id || item.timezone !== plan.timezone
      || (plan.kind === 'weekdays' && !plan.weekdays.includes(((new Date(`${item.occurrence_date}T12:00:00Z`).getUTCDay() + 6) % 7) + 1))
      || dates.has(key) || typeof item.note !== 'string' || item.note.length > 1000) throw new Error('Check-in duplicato o non valido nel backup.');
    dates.add(key);
  }
  return data as Backup;
}

export async function importBackup(db: SQLiteDatabase, backup: Backup) {
  validateBackup(backup);
  const existing = new Map((await db.getAllAsync<HabitRow>('SELECT * FROM habits')).map((item) => [item.id, item]));
  for (const item of backup.habits) {
    const local = existing.get(item.id);
    if (local && (local.name !== item.name || local.start_date !== item.start_date || local.created_at !== item.created_at)) {
      throw new Error(`Conflitto sul backup per “${item.name}”: stesso ID, contenuto diverso.`);
    }
  }
  const incoming = backup.habits.filter((item) => !existing.has(item.id));
  const accepted = new Set(incoming.map((item) => item.id));
  await db.withExclusiveTransactionAsync(async (tx) => {
    for (const item of incoming) await tx.runAsync('INSERT INTO habits VALUES (?,?,?,?,?,?,?,?,?,?)',
      item.id, item.name, item.goal, item.icon, item.color, item.start_date, item.status,
      item.archived_on, item.created_at, item.updated_at);
    for (const item of backup.schedules.filter((entry) => accepted.has(entry.habit_id))) {
      await tx.runAsync('INSERT INTO schedules VALUES (?,?,?,?,?,?,?,?)', item.id, item.habit_id,
        item.kind, JSON.stringify(item.weekdays), item.target_per_week, item.timezone, item.effective_from, item.created_at);
    }
    for (const item of backup.pauses.filter((entry) => accepted.has(entry.habit_id))) {
      await tx.runAsync('INSERT INTO pauses VALUES (?,?,?,?,?)', item.id, item.habit_id, item.start_date, item.end_date, item.created_at);
    }
    for (const item of backup.checkins.filter((entry) => accepted.has(entry.habit_id))) {
      await tx.runAsync('INSERT INTO checkins VALUES (?,?,?,?,?,?,?)', item.id, item.habit_id, item.schedule_id,
        item.occurrence_date, item.completed_at, item.timezone, item.note);
    }
  });
  return { imported: incoming.length, skipped: backup.habits.length - incoming.length };
}

export async function seedDemo(db: SQLiteDatabase) {
  const examples = [
    { id: '11111111-1111-4111-8111-111111111111', name: 'Camminata consapevole', goal: 'Dieci minuti all’aria aperta.', icon: 'walk', color: '#315848', kind: 'daily', target: 1 },
    { id: '22222222-2222-4222-8222-222222222222', name: 'Leggere dieci pagine', goal: 'Un po’ di calma prima di sera.', icon: 'book-open-page-variant', color: '#8A5E3C', kind: 'weekdays', target: 1 },
    { id: '33333333-3333-4333-8333-333333333333', name: 'Muoversi con gentilezza', goal: 'Tre momenti a settimana.', icon: 'heart-outline', color: '#925E78', kind: 'times_per_week', target: 3 },
  ] as const;
  const current = new Set((await db.getAllAsync<{ id: string }>('SELECT id FROM habits')).map((item) => item.id));
  const settings = await readSettings(db);
  const day = localToday(settings.timezone);
  const start = new Date(`${day}T12:00:00Z`);
  start.setUTCDate(start.getUTCDate() - 30);
  const startDate = start.toISOString().slice(0, 10);
  const now = timestamp();
  let created = 0;
  await db.withExclusiveTransactionAsync(async (tx) => {
    for (const example of examples) {
      if (current.has(example.id)) continue;
      const scheduleId = example.id.replace(/^./, 'a');
      await tx.runAsync('INSERT INTO habits VALUES (?,?,?,?,?,?,?,?,?,?)', example.id, example.name, example.goal,
        example.icon, example.color, startDate, 'active', null, now, now);
      await tx.runAsync('INSERT INTO schedules VALUES (?,?,?,?,?,?,?,?)', scheduleId, example.id,
        example.kind, JSON.stringify(example.kind === 'weekdays' ? [1, 3, 5] : []), example.target, settings.timezone, startDate, now);
      for (let offset = 0; offset < 31; offset++) {
        const date = new Date(start.getTime() + offset * 86_400_000).toISOString().slice(0, 10);
        if (date > day) break;
        const iso = ((new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;
        const doIt = example.kind === 'daily' ? offset % 7 !== 3 : example.kind === 'weekdays' ? [1, 3, 5].includes(iso) && offset % 11 !== 0 : offset % 3 === 0;
        if (doIt) await tx.runAsync('INSERT INTO checkins VALUES (?,?,?,?,?,?,?)', id(), example.id, scheduleId, date, now, settings.timezone, 'Dataset demo sintetico');
      }
      created++;
    }
  });
  return created;
}
