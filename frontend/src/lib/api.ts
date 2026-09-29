import type { Analytics, Habit, HabitInput, Settings } from '../types';

const ROOT = '/api/v1';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status = 500,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${ROOT}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    ...init,
  });
  if (response.status === 204) return undefined as T;
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      typeof payload === 'object' && payload !== null && 'error' in payload
        ? String(
            (payload as { error?: { message?: string } }).error?.message ??
              'Impossibile completare l’operazione.',
          )
        : 'Impossibile raggiungere HabitFlow.';
    throw new ApiError(message, response.status);
  }
  return payload as T;
}

export const api = {
  settings: () => request<Settings>('/settings'),
  saveSettings: (body: Partial<Settings>) =>
    request<Settings>('/settings', { method: 'PATCH', body: JSON.stringify(body) }),
  habits: () => request<Habit[]>('/habits'),
  habit: (id: string) => request<Habit>(`/habits/${id}`),
  createHabit: (body: HabitInput) =>
    request<Habit>('/habits', { method: 'POST', body: JSON.stringify(body) }),
  updateHabit: (id: string, body: Partial<HabitInput>) =>
    request<Habit>(`/habits/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteHabit: (id: string) => request<void>(`/habits/${id}`, { method: 'DELETE' }),
  action: (id: string, action: 'pause' | 'resume' | 'archive' | 'restore') =>
    request<Habit>(`/habits/${id}/${action}`, { method: 'POST' }),
  checkin: (id: string, date: string, note: string) =>
    request<Habit>(`/habits/${id}/checkins/${date}`, { method: 'PUT', body: JSON.stringify({ note }) }),
  undo: (id: string, date: string) =>
    request<void>(`/habits/${id}/checkins/${date}`, { method: 'DELETE' }),
  analytics: (days: number, habitId?: string) =>
    request<Analytics>(`/analytics?days=${days}${habitId ? `&habit_id=${habitId}` : ''}`),
  export: () => request<unknown>('/data/export'),
  import: (data: unknown) =>
    request<{ imported: number; skipped: number }>('/data/import', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  demo: () => request<{ created: number }>('/data/demo', { method: 'POST' }),
};
