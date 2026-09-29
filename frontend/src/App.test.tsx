import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';

const apiMock = vi.hoisted(() => ({
  settings: vi.fn(),
  habits: vi.fn(),
  checkin: vi.fn(),
  undo: vi.fn(),
  habit: vi.fn(),
  analytics: vi.fn(),
  saveSettings: vi.fn(),
  export: vi.fn(),
  import: vi.fn(),
  demo: vi.fn(),
  createHabit: vi.fn(),
  updateHabit: vi.fn(),
  deleteHabit: vi.fn(),
  action: vi.fn(),
}));
vi.mock('./lib/api', () => ({ api: apiMock }));

const habit = {
  id: 'one',
  name: 'Camminare',
  goal: 'Aria e movimento',
  icon: 'leaf',
  color: '#314e42',
  start_date: '2026-09-19',
  status: 'active' as const,
  schedule: {
    kind: 'daily' as const,
    weekdays: [],
    target_per_week: 1,
    timezone: 'Europe/Rome',
    effective_from: '2026-09-19',
  },
  pending_schedule: null,
  today: '2026-09-19',
  is_due: true,
  completed_today: false,
  note_today: '',
  stats: {
    current_streak: 2,
    best_streak: 4,
    streak_unit: 'sessions' as const,
    completed: 2,
    expected: 3,
    completion_rate: 66,
    total_checkins: 2,
    week_completed: 2,
    week_target: 4,
  },
};

describe('HabitFlow UI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMock.settings.mockResolvedValue({
      display_name: 'Alex',
      timezone: 'Europe/Rome',
      onboarding_completed: true,
    });
    apiMock.habits.mockResolvedValue([habit]);
  });
  it('renders today and persists a visible idempotent completion state', async () => {
    apiMock.checkin.mockResolvedValue({
      ...habit,
      completed_today: true,
      note_today: 'Passeggiata lenta',
    });
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Buongiorno.' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Aggiungi una nota' }));
    fireEvent.change(screen.getByLabelText('Nota per oggi'), { target: { value: 'Passeggiata lenta' } });
    fireEvent.click(screen.getByRole('button', { name: 'Segna completata Camminare' }));
    await waitFor(() =>
      expect(apiMock.checkin).toHaveBeenCalledWith('one', '2026-09-19', 'Passeggiata lenta'),
    );
    expect(await screen.findByRole('button', { name: 'Annulla completamento Camminare' })).toBeVisible();
  });
  it('excludes unscheduled habits from Today while keeping their plan intact', async () => {
    apiMock.habits.mockResolvedValue([
      { ...habit, name: 'Solo domani', is_due: false, completed_today: false },
    ]);
    render(<App />);
    await screen.findByRole('heading', { name: 'Buongiorno.' });
    expect(screen.queryByRole('heading', { name: 'Solo domani' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'La tua giornata è libera.' })).toBeVisible();
  });

  it('keeps onboarding progression deliberate until a local name is supplied', async () => {
    apiMock.settings.mockResolvedValue({
      display_name: '',
      timezone: 'Europe/Rome',
      onboarding_completed: false,
    });
    apiMock.habits.mockResolvedValue([]);
    render(<App />);
    const continueButton = await screen.findByRole('button', { name: 'Continua' });
    expect(continueButton).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText('Il tuo nome'), { target: { value: 'Marta' } });
    expect(continueButton).toBeEnabled();
  });

  it('shows a local-data explanation in settings', async () => {
    render(<App />);
    await screen.findByRole('heading', { name: 'Buongiorno.' });
    fireEvent.click(screen.getAllByRole('button', { name: 'Impostazioni' })[0]);
    expect(await screen.findByRole('heading', { name: 'Impostazioni' })).toBeVisible();
    expect(screen.getByText(/resta locale per impostazione predefinita/i)).toBeVisible();
  });

  it('renders an accessible analytics calendar with a textual data path', async () => {
    apiMock.analytics.mockResolvedValue({
      from_date: '2026-09-01',
      to_date: '2026-09-19',
      completed: 2,
      expected: 3,
      completion_rate: 66,
      total_checkins: 2,
      active_habits: 1,
      calendar: [{ date: '2026-09-19', completed: 1, expected: 1 }],
      weekly: [{ label: 'Set 38', completed: 1, expected: 2 }],
      monthly: [{ label: 'Set', completed: 1, expected: 2 }],
      habits: [habit],
    });
    render(<App />);
    await screen.findByRole('heading', { name: 'Buongiorno.' });
    fireEvent.click(screen.getAllByRole('button', { name: 'Progressi' })[0]);
    expect(await screen.findByRole('img', { name: /Calendario dal 2026-09-01/i })).toBeVisible();
    expect(screen.getByText('Mostra i dati del calendario in tabella')).toBeVisible();
  });

  it('explains an unavailable local API and retries without losing the recovery path', async () => {
    apiMock.settings
      .mockRejectedValueOnce(new Error('API temporaneamente non disponibile.'))
      .mockResolvedValue({ display_name: 'Alex', timezone: 'Europe/Rome', onboarding_completed: true });
    render(<App />);
    expect(await screen.findByText('API temporaneamente non disponibile.')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Riprova' }));
    expect(await screen.findByRole('heading', { name: 'Buongiorno.' })).toBeVisible();
  });

  it('retries analytics after an error instead of leaving a dead Retry control', async () => {
    apiMock.analytics
      .mockRejectedValueOnce(new Error('Analisi momentaneamente non disponibile.'))
      .mockResolvedValue({
        from_date: '2026-09-01',
        to_date: '2026-09-19',
        completed: 1,
        expected: 2,
        completion_rate: 50,
        total_checkins: 1,
        active_habits: 1,
        calendar: [{ date: '2026-09-19', completed: 1, expected: 1 }],
        weekly: [],
        monthly: [],
        habits: [habit],
      });
    render(<App />);
    await screen.findByRole('heading', { name: 'Buongiorno.' });
    fireEvent.click(screen.getAllByRole('button', { name: 'Progressi' })[0]);
    expect(await screen.findByText('Analisi momentaneamente non disponibile.')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Riprova' }));
    expect(await screen.findByRole('img', { name: /Calendario dal 2026-09-01/i })).toBeVisible();
  });

  it('keeps a pending schedule when an editor changes only descriptive fields', async () => {
    const pending = {
      ...habit,
      pending_schedule: {
        ...habit.schedule,
        kind: 'weekdays' as const,
        weekdays: [1, 3, 5],
        effective_from: '2026-09-21',
      },
    };
    apiMock.habits.mockResolvedValue([pending]);
    apiMock.updateHabit.mockResolvedValue({ ...pending, goal: 'Una passeggiata più gentile.' });
    render(<App />);
    await screen.findByRole('heading', { name: 'Buongiorno.' });
    fireEvent.click(screen.getAllByRole('button', { name: 'Abitudini' })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Azioni per Camminare' }));
    fireEvent.click(screen.getByRole('button', { name: 'Modifica' }));
    fireEvent.change(screen.getByLabelText('Obiettivo'), {
      target: { value: 'Una passeggiata più gentile.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Salva modifiche' }));
    await waitFor(() => expect(apiMock.updateHabit).toHaveBeenCalled());
    expect(apiMock.updateHabit).toHaveBeenLastCalledWith('one', {
      name: 'Camminare',
      goal: 'Una passeggiata più gentile.',
    });
  });
});
