import { describe, expect, it } from 'vitest';
import { eligible, habitToday, isDue, localToday, monthGrid, nextMonday, stats } from './domain';
import type { HabitData, Schedule } from './types';

const start = '2026-01-05';
function habit(options: {
  kind?: Schedule['kind']; target?: number; weekdays?: number[]; checked?: string[];
  pauses?: { start_date: string; end_date: string | null }[]; first?: string;
  revision?: Partial<Schedule>;
} = {}): HabitData {
  const first = options.first ?? start;
  const schedule: Schedule = { id: 'schedule-1', habit_id: 'habit-1', kind: options.kind ?? 'daily',
    weekdays: options.weekdays ?? [], target_per_week: options.target ?? 1, timezone: 'Europe/Rome',
    effective_from: first, created_at: '2026-01-05T00:00:00Z' };
  return {
    id: 'habit-1', name: 'Leggere', goal: '', icon: 'leaf', color: '#315848', start_date: first,
    status: 'active', archived_on: null, created_at: '2026-01-05T00:00:00Z', updated_at: '2026-01-05T00:00:00Z',
    schedules: options.revision ? [schedule, { ...schedule, ...options.revision, id: 'schedule-2' }] : [schedule],
    pauses: (options.pauses ?? []).map((pause) => ({ ...pause, id: 'pause', habit_id: 'habit-1', created_at: '2026-01-05T00:00:00Z' })),
    checkins: (options.checked ?? []).map((date) => ({ id: date, habit_id: 'habit-1', schedule_id: 'schedule-1',
      occurrence_date: date, completed_at: `${date}T12:00:00Z`, timezone: 'Europe/Rome', note: '' })),
  };
}

describe('regole mobili allineate al dominio web', () => {
  it('sposta il piano al lunedì successivo anche quando oggi è lunedì', () => {
    expect(nextMonday('2026-09-14')).toBe('2026-09-21');
    expect(nextMonday('2026-09-16')).toBe('2026-09-21');
  });
  it('risolve il giorno civile dopo il cambio DST', () => {
    expect(localToday('Europe/Rome', new Date('2026-03-29T22:30:00Z'))).toBe('2026-03-30');
    expect(localToday('Europe/Rome', new Date('2026-03-29T01:30:00Z'))).toBe('2026-03-29');
  });
  it('un giorno saltato interrompe la streak, oggi aperto no', () => {
    expect(stats(habit({ checked: [start] }), '2026-01-07')).toMatchObject({ current: 0, best: 1, expected: 2, completed: 1, rate: 50 });
  });
  it('il completamento di oggi aumenta la streak ma non il tasso già concluso', () => {
    expect(stats(habit({ checked: [start, '2026-01-06', '2026-01-07'] }), '2026-01-07')).toMatchObject({ current: 3, best: 3, expected: 2, completed: 2, total: 3 });
  });
  it('i giorni non programmati non spezzano una frequenza selezionata', () => {
    expect(stats(habit({ kind: 'weekdays', weekdays: [1, 3, 5], checked: [start, '2026-01-07'] }), '2026-01-08'))
      .toMatchObject({ current: 2, best: 2, expected: 2, completed: 2, weekTarget: 3 });
  });
  it('la pausa protegge i giorni senza cancellare un check-in già fatto', () => {
    const value = habit({ checked: [start, '2026-01-06', '2026-01-08'], pauses: [{ start_date: '2026-01-06', end_date: '2026-01-08' }] });
    expect(eligible(value, '2026-01-06')).toBe(true);
    expect(eligible(value, '2026-01-07')).toBe(false);
    expect(stats(value, '2026-01-09')).toMatchObject({ current: 3, best: 3, expected: 3, completed: 3 });
  });
  it('3 volte a settimana chiude la settimana prima di calcolare il tasso', () => {
    const value = habit({ kind: 'times_per_week', target: 3, checked: [start, '2026-01-07', '2026-01-09'] });
    expect(stats(value, '2026-01-11')).toMatchObject({ current: 1, expected: 0, rate: null, weekCompleted: 3 });
    expect(stats(value, '2026-01-12')).toMatchObject({ current: 1, expected: 3, completed: 3, rate: 100 });
  });
  it('check-in extra restano visibili ma il tasso non supera 100%', () => {
    expect(stats(habit({ kind: 'times_per_week', target: 3, checked: [start, '2026-01-06', '2026-01-07', '2026-01-08'] }), '2026-01-12'))
      .toMatchObject({ expected: 3, completed: 3, total: 4, rate: 100 });
  });
  it('una prima settimana parziale ha un obiettivo raggiungibile', () => {
    expect(stats(habit({ first: '2026-01-10', kind: 'times_per_week', target: 3, checked: ['2026-01-10', '2026-01-11'] }), '2026-01-12'))
      .toMatchObject({ expected: 2, completed: 2, weekTarget: 3 });
  });
  it('usa settimane ISO nel passaggio di anno', () => {
    expect(stats(habit({ first: '2025-12-29', kind: 'times_per_week', target: 1, checked: ['2025-12-31'] }), '2026-01-05'))
      .toMatchObject({ expected: 1, completed: 1, current: 1 });
  });
  it('non interpreta il fuso futuro prima del suo lunedì', () => {
    const value = habit({ first: '2026-03-23', revision: { effective_from: '2026-03-30', timezone: 'America/New_York' } });
    expect(habitToday(value, new Date('2026-03-29T22:30:00Z'))).toBe('2026-03-29');
  });
  it('un piano futuro non crea debiti né check-in disponibili', () => {
    const value = habit({ first: '2026-01-12' });
    expect(stats(value, '2026-01-05')).toMatchObject({ expected: 0, total: 0, current: 0, weekTarget: 0 });
    expect(monthGrid(value, 2026, 0, '2026-01-05').filter((day) => day.planned)).toHaveLength(0);
  });
  it('un piano settimanale già completato oggi non appare tra i gesti dovuti', () => {
    const value = habit({ kind: 'times_per_week', target: 1, checked: ['2026-01-05'] });
    expect(isDue(value, new Date('2026-01-07T12:00:00Z'))).toBe(false);
  });
});
