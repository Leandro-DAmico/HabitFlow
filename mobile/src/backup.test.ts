import { describe, expect, it, vi } from 'vitest';
import type { Backup } from './types';
import { validateBackup } from './store';

vi.mock('expo-crypto', () => ({ randomUUID: () => '44444444-4444-4444-8444-444444444444' }));

const fixture = (): Backup => ({
  format: 'habitflow-backup', version: 1, exported_at: '2026-09-24T10:00:00Z',
  settings: { display_name: 'Ada', timezone: 'Europe/Rome', onboarding_completed: true },
  habits: [{ id: '11111111-1111-4111-8111-111111111111', name: 'Leggere', goal: 'Dieci pagine',
    icon: 'leaf', color: '#315848', start_date: '2026-09-21', status: 'active', archived_on: null,
    created_at: '2026-09-21T08:00:00Z', updated_at: '2026-09-21T08:00:00Z' }],
  schedules: [{ id: '22222222-2222-4222-8222-222222222222', habit_id: '11111111-1111-4111-8111-111111111111',
    kind: 'daily', weekdays: [], target_per_week: 1, timezone: 'Europe/Rome', effective_from: '2026-09-21',
    created_at: '2026-09-21T08:00:00Z' }],
  pauses: [],
  checkins: [{ id: '33333333-3333-4333-8333-333333333333', habit_id: '11111111-1111-4111-8111-111111111111',
    schedule_id: '22222222-2222-4222-8222-222222222222', occurrence_date: '2026-09-21',
    completed_at: '2026-09-21T19:00:00Z', timezone: 'Europe/Rome', note: '' }],
});

describe('backup compatibile con il formato web v1', () => {
  it('accetta un grafo completo con date civili e check-in', () => {
    expect(validateBackup(fixture()).checkins).toHaveLength(1);
  });
  it('rifiuta date impossibili e riferimenti al piano sbagliato', () => {
    const invalidDate = fixture();
    invalidDate.checkins[0].occurrence_date = '2026-02-30';
    expect(() => validateBackup(invalidDate)).toThrow();
    const invalidPlan = fixture();
    invalidPlan.checkins[0].schedule_id = '99999999-9999-4999-8999-999999999999';
    expect(() => validateBackup(invalidPlan)).toThrow();
  });
  it('rifiuta duplicati e fusi non validi prima di scrivere', () => {
    const duplicate = fixture();
    duplicate.checkins.push({ ...duplicate.checkins[0] });
    expect(() => validateBackup(duplicate)).toThrow();
    const invalidZone = fixture();
    invalidZone.schedules[0].timezone = 'Mars/Colony';
    expect(() => validateBackup(invalidZone)).toThrow();
  });
});
