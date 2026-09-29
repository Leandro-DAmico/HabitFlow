import * as Dialog from '@radix-ui/react-dialog';
import {
  Archive,
  BarChart3,
  CalendarDays,
  Check,
  ChevronRight,
  Download,
  Flame,
  Flower2,
  HeartPulse,
  Home,
  Leaf,
  MoreHorizontal,
  NotebookPen,
  Pause,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Settings2,
  Sparkles,
  Target,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState, type ComponentType, type FormEvent, type ReactNode } from 'react';
import { api } from './lib/api';
import type {
  Analytics,
  Habit,
  HabitInput,
  HabitStatus,
  Schedule,
  ScheduleKind,
  Settings,
} from './types';

type Page = 'today' | 'habits' | 'analytics' | 'settings' | 'new-habit';
const today = () => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const field = (type: 'year' | 'month' | 'day') =>
    parts.find((part) => part.type === type)?.value ?? '';
  return `${field('year')}-${field('month')}-${field('day')}`;
};
const defaultTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Rome';
const iconMap: Record<string, ComponentType<{ size?: number; strokeWidth?: number }>> = {
  leaf: Leaf,
  heart: HeartPulse,
  target: Target,
  flower: Flower2,
  sparkles: Sparkles,
};
const iconOptions = Object.keys(iconMap);
const palette = ['#314e42', '#a65e35', '#a97821', '#6c658b', '#a44756'];
const weekdayNames = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'];

function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const C = iconMap[name] ?? Leaf;
  return <C size={size} strokeWidth={1.8} />;
}
function scheduleText(habit: Habit): string {
  if (habit.schedule.kind === 'daily') return 'Ogni giorno';
  if (habit.schedule.kind === 'times_per_week')
    return `${habit.schedule.target_per_week} volte a settimana`;
  const days = habit.schedule.weekdays.map((day) => weekdayNames[day - 1]).join(' · ');
  return days || 'Giorni scelti';
}
function scheduleSummary(schedule: Schedule): string {
  if (schedule.kind === 'daily') return 'Ogni giorno';
  if (schedule.kind === 'times_per_week') return `${schedule.target_per_week} volte a settimana`;
  const days = schedule.weekdays.map((day) => weekdayNames[day - 1]).join(' · ');
  return days || 'Giorni scelti';
}
function rateLabel(value: number | null): string {
  return value === null ? '—' : `${Math.round(value)}%`;
}
function errorText(error: unknown): string {
  return error instanceof Error ? error.message : 'Si è verificato un errore inatteso.';
}

export default function App() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [habits, setHabits] = useState<Habit[]>([]);
  const [page, setPage] = useState<Page>('today');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState('');

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const [nextSettings, nextHabits] = await Promise.all([api.settings(), api.habits()]);
      setSettings(nextSettings);
      setHabits(nextHabits);
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void refresh();
  }, []);
  const announce = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(''), 3500);
  };
  const updateHabit = (next: Habit) =>
    setHabits((current) => current.map((habit) => (habit.id === next.id ? next : habit)));
  const navigate = (next: Page) => {
    setPage(next);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    window.setTimeout(() => document.querySelector<HTMLElement>('#main')?.focus(), 0);
  };

  if (loading) return <LoadingScreen />;
  if (error && !settings) return <ErrorScreen message={error} retry={() => void refresh()} />;
  if (!settings || !settings.onboarding_completed)
    return (
      <Onboarding
        onComplete={async (value) => {
          await api.saveSettings(value);
          await refresh();
        }}
      />
    );

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Vai al contenuto
      </a>
      <aside className="sidebar">
        <Brand />
        <Nav page={page} navigate={navigate} />
        <button className="sidebar-create" onClick={() => navigate('new-habit')}>
          <Plus size={18} /> Nuova abitudine
        </button>
        <div className="sidebar-foot">
          <span className="local-pill">
            <Leaf size={14} /> Solo sul tuo dispositivo
          </span>
          <button className="quiet-button" onClick={() => navigate('settings')}>
            <Settings2 size={18} /> Impostazioni
          </button>
        </div>
      </aside>
      <header className="mobile-header">
        <Brand compact />
        <button className="icon-button" aria-label="Impostazioni" onClick={() => navigate('settings')}>
          <Settings2 size={20} />
        </button>
      </header>
      <main id="main" tabIndex={-1}>
        {error && <InlineError message={error} retry={() => void refresh()} />}
        {page === 'today' && (
          <Today habits={habits} onChange={updateHabit} onNotice={announce} navigate={navigate} />
        )}
        {page === 'habits' && (
          <Habits
            habits={habits}
            onChange={updateHabit}
            onRemove={(id) => setHabits((items) => items.filter((h) => h.id !== id))}
            onNotice={announce}
            navigate={navigate}
          />
        )}
        {page === 'new-habit' && (
          <HabitForm
            settings={settings}
            onCancel={() => navigate('habits')}
            onSaved={(habit) => {
              setHabits((items) => [...items, habit]);
              announce('Abitudine creata. Il primo passo è pronto.');
              navigate('today');
            }}
          />
        )}
        {page === 'analytics' && <AnalyticsPage habits={habits} />}
        {page === 'settings' && (
          <SettingsPage
            settings={settings}
            setSettings={setSettings}
            onNotice={announce}
            onRefresh={refresh}
          />
        )}
      </main>
      <nav className="bottom-nav" aria-label="Navigazione principale">
        <Nav page={page} navigate={navigate} compact />
      </nav>
      {page !== 'new-habit' && (
        <button
          className="floating-add"
          aria-label="Nuova abitudine"
          onClick={() => navigate('new-habit')}
        >
          <Plus size={20} /> <span>Nuova abitudine</span>
        </button>
      )}
      <div className="sr-notice" aria-live="polite">
        {notice}
      </div>
    </div>
  );
}

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className="brand">
      <span className="brand-mark">
        <Leaf size={compact ? 19 : 22} />
      </span>
      {!compact && (
        <span>
          Habit<span>Flow</span>
        </span>
      )}
    </div>
  );
}
function Nav({
  page,
  navigate,
  compact = false,
}: {
  page: Page;
  navigate: (page: Page) => void;
  compact?: boolean;
}) {
  const entries: { id: Page; label: string; icon: ComponentType<{ size?: number }> }[] = [
    { id: 'today', label: 'Oggi', icon: Home },
    { id: 'habits', label: 'Abitudini', icon: NotebookPen },
    { id: 'analytics', label: 'Progressi', icon: BarChart3 },
  ];
  return (
    <div className={compact ? 'nav-list bottom-list' : 'nav-list'}>
      {entries.map(({ id, label, icon: NavIcon }) => (
        <button
          key={id}
          className={page === id ? 'nav-item active' : 'nav-item'}
          aria-current={page === id ? 'page' : undefined}
          onClick={() => navigate(id)}
        >
          <NavIcon size={20} />
          <span>{label}</span>
        </button>
      ))}
    </div>
  );
}
function LoadingScreen() {
  return (
    <div className="screen-center">
      <div className="loading-leaf">
        <Leaf size={30} />
      </div>
      <p>Sto preparando il tuo spazio tranquillo…</p>
    </div>
  );
}
function ErrorScreen({ message, retry }: { message: string; retry: () => void }) {
  return (
    <div className="screen-center">
      <div className="error-mark">!</div>
      <h1>Non riusciamo a raggiungere i tuoi dati.</h1>
      <p>{message}</p>
      <button className="primary-button" onClick={retry}>
        <RotateCcw size={18} /> Riprova
      </button>
    </div>
  );
}
function InlineError({ message, retry }: { message: string; retry: () => void }) {
  return (
    <div className="inline-error" role="alert">
      <span>{message}</span>
      <button onClick={retry}>Riprova</button>
    </div>
  );
}

function Onboarding({ onComplete }: { onComplete: (value: Partial<Settings>) => Promise<void> }) {
  const [step, setStep] = useState(1);
  const [name, setName] = useState('');
  const [timezone, setTimezone] = useState(defaultTimeZone);
  const [saving, setSaving] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const submit = async () => {
    setSaving(true);
    setSubmitError('');
    try {
      await onComplete({ display_name: name.trim(), timezone, onboarding_completed: true });
    } catch (reason) {
      setSubmitError(errorText(reason));
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="onboarding">
      <a className="skip-link" href="#onboarding-main">
        Vai al contenuto
      </a>
      <div className="onboarding-aside">
        <Brand />
        <div className="onboarding-art" aria-hidden="true">
          <svg viewBox="0 0 280 260">
            <path d="M31 201C38 89 115 42 218 24c-14 112-78 182-187 177Z" fill="#dce5d9" />
            <path
              d="M53 214c50-78 101-128 166-169"
              fill="none"
              stroke="#314e42"
              strokeWidth="5"
              strokeLinecap="round"
            />
            <circle cx="222" cy="39" r="16" fill="#c89235" />
          </svg>
        </div>
        <p>Un posto locale per abitudini che si adattano alla vita, non il contrario.</p>
      </div>
      <main id="onboarding-main" className="onboarding-card">
        <div className="stepper" aria-label={`Passo ${step} di 3`}>
          <span className="step-count">0{step} / 03</span>
          <div>
            <i className={step >= 1 ? 'done' : ''} />
            <i className={step >= 2 ? 'done' : ''} />
            <i className={step >= 3 ? 'done' : ''} />
          </div>
        </div>
        {step === 1 && (
          <>
            <p className="eyebrow">Benvenuto</p>
            <h1>Fai spazio a ciò che conta.</h1>
            <p className="lede">
              HabitFlow rende visibile la tua costanza senza trasformarla in una gara.
            </p>
            <label>
              Come ti chiami?
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Il tuo nome"
                autoComplete="name"
              />
            </label>
            <button className="primary-button wide" disabled={!name.trim()} onClick={() => setStep(2)}>
              Continua <ChevronRight size={18} />
            </button>
          </>
        )}
        {step === 2 && (
          <>
            <p className="eyebrow">Il tuo tempo</p>
            <h1>Il calendario resta dalla tua parte.</h1>
            <p className="lede">
              Salviamo il tuo fuso per rispettare i giorni come li vivi. Puoi cambiarlo in seguito.
            </p>
            <label>
              Fuso orario
              <select value={timezone} onChange={(e) => setTimezone(e.target.value)}>
                <option value={timezone}>{timezone}</option>
                <option value="Europe/Rome">Europe/Rome</option>
                <option value="Europe/London">Europe/London</option>
                <option value="America/New_York">America/New_York</option>
              </select>
            </label>
            <div className="button-row">
              <button className="secondary-button" onClick={() => setStep(1)}>
                Indietro
              </button>
              <button className="primary-button" onClick={() => setStep(3)}>
                Continua <ChevronRight size={18} />
              </button>
            </div>
          </>
        )}
        {step === 3 && (
          <>
            <p className="eyebrow">Pronto</p>
            <h1>Ciao, {name.trim()}.</h1>
            <p className="lede">
              Inizia con un gesto piccolo e realistico. Potrai mettere in pausa o riprendere quando vuoi.
            </p>
            {submitError && (
              <p className="field-error" role="alert">
                {submitError}
              </p>
            )}
            <button className="primary-button wide" onClick={() => setFormOpen(true)}>
              <Plus size={18} /> Crea la prima abitudine
            </button>
            <button className="text-button" disabled={saving} onClick={() => void submit()}>
              Esplora prima{saving ? '…' : ''}
            </button>
          </>
        )}
        <Dialog.Root open={formOpen} onOpenChange={setFormOpen}>
          <Dialog.Portal>
            <Dialog.Overlay className="dialog-overlay" />
            <Dialog.Content className="dialog-content onboarding-dialog">
              <Dialog.Title>Crea la tua prima abitudine</Dialog.Title>
              <Dialog.Description>Puoi sempre modificarla più avanti.</Dialog.Description>
              <QuickHabit
                onCancel={() => setFormOpen(false)}
                onCreate={async () => {
                  await submit();
                }}
                timezone={timezone}
              />
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      </main>
    </div>
  );
}

function Today({
  habits,
  onChange,
  onNotice,
  navigate,
}: {
  habits: Habit[];
  onChange: (habit: Habit) => void;
  onNotice: (message: string) => void;
  navigate: (page: Page) => void;
}) {
  const active = habits.filter(
    (habit) => habit.status === 'active' && (habit.is_due || habit.completed_today),
  );
  const allActive = habits.filter((habit) => habit.status === 'active');
  const completed = active.filter((habit) => habit.completed_today).length;
  const formatted = new Intl.DateTimeFormat('it-IT', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date());
  const weekCompleted = allActive.reduce((sum, habit) => sum + habit.stats.week_completed, 0);
  const weekTarget = allActive.reduce((sum, habit) => sum + habit.stats.week_target, 0);
  const totalCheckins = allActive.reduce((sum, habit) => sum + habit.stats.total_checkins, 0);
  return (
    <section className="page">
      <header className="page-hero today-hero">
        <div>
          <p className="eyebrow">{formatted}</p>
          <h1>Buongiorno.</h1>
          <p className="lede">Piccoli passi, al tuo ritmo.</p>
        </div>
        <div className="today-hero-aside">
          <svg aria-hidden="true" viewBox="0 0 135 100">
            <path d="M11 87C19 35 55 11 111 9 96 59 60 91 11 87Z" fill="#dce5d9" />
            <path
              d="M26 90C47 58 70 36 105 16"
              fill="none"
              stroke="#314e42"
              strokeWidth="3"
              strokeLinecap="round"
            />
            <circle cx="116" cy="15" r="8" fill="#c89235" />
          </svg>
          <div className="daily-progress">
            <span>
              {completed}/{active.length}
            </span>
            <small>momenti di oggi</small>
          </div>
        </div>
      </header>
      {active.length === 0 ? (
        <EmptyToday navigate={navigate} />
      ) : (
        <>
          <div className="rhythm-strip" aria-label="Riepilogo del tuo ritmo">
            <article>
              <span>Settimana</span>
              <strong>
                {weekCompleted}/{weekTarget || '—'}
              </strong>
              <small>momenti scelti</small>
            </article>
            <article>
              <span>Check-in totali</span>
              <strong>{totalCheckins}</strong>
              <small>gesti registrati</small>
            </article>
            <article>
              <span>Oggi</span>
              <strong>{completed === active.length ? 'Fatto' : 'In corso'}</strong>
              <small>senza recuperi forzati</small>
            </article>
          </div>
          <div className="today-intro">
            <span className="section-kicker">Il tuo ritmo</span>
            <p>
              {completed === active.length
                ? 'Tutto fatto per oggi. Lascia che basti così.'
                : 'Scegli il prossimo gesto, non il più perfetto.'}
            </p>
          </div>
          <div className="habit-grid">
            {active.map((habit) => (
              <TodayHabit key={habit.id} habit={habit} onChange={onChange} onNotice={onNotice} />
            ))}
          </div>
        </>
      )}
    </section>
  );
}
function EmptyToday({ navigate }: { navigate: (page: Page) => void }) {
  return (
    <div className="empty-state warm-empty">
      <div className="empty-illustration">
        <svg viewBox="0 0 180 150" aria-hidden="true">
          <path d="M25 122C32 48 91 21 149 18c-9 67-54 109-124 104Z" fill="#dce5d9" />
          <path
            d="M42 129C76 78 96 56 138 31"
            stroke="#314e42"
            strokeWidth="4"
            fill="none"
            strokeLinecap="round"
          />
        </svg>
      </div>
      <h2>La tua giornata è libera.</h2>
      <p>Una buona abitudine comincia da un piano gentile e possibile.</p>
      <button className="primary-button" onClick={() => navigate('new-habit')}>
        <Plus size={18} /> Crea la prima abitudine
      </button>
    </div>
  );
}
function TodayHabit({
  habit,
  onChange,
  onNotice,
}: {
  habit: Habit;
  onChange: (habit: Habit) => void;
  onNotice: (message: string) => void;
}) {
  const [noteOpen, setNoteOpen] = useState(Boolean(habit.note_today));
  const [note, setNote] = useState(habit.note_today);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const noteChanged = note !== habit.note_today;
  const complete = async () => {
    setBusy(true);
    setActionError('');
    try {
      const next = await api.checkin(habit.id, habit.today, note);
      onChange(next);
      onNotice(`${habit.name}: completata.`);
    } catch (reason) {
      const message = errorText(reason);
      setActionError(message);
      onNotice(message);
    } finally {
      setBusy(false);
    }
  };
  const undo = async () => {
    setBusy(true);
    setActionError('');
    try {
      await api.undo(habit.id, habit.today);
      onChange(await api.habit(habit.id));
      onNotice(`${habit.name}: completamento annullato.`);
    } catch (reason) {
      const message = errorText(reason);
      setActionError(message);
      onNotice(message);
    } finally {
      setBusy(false);
    }
  };
  const saveNote = async () => {
    setBusy(true);
    setActionError('');
    try {
      onChange(await api.checkin(habit.id, habit.today, note));
      onNotice(`Nota per ${habit.name} salvata.`);
    } catch (reason) {
      const message = errorText(reason);
      setActionError(message);
      onNotice(message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <article className={habit.completed_today ? 'today-card completed' : 'today-card'}>
      <div className="habit-icon" style={{ backgroundColor: `${habit.color}20`, color: habit.color }}>
        <Icon name={habit.icon} />
      </div>
      <div className="today-card-copy">
        <div className="habit-title-row">
          <h2>{habit.name}</h2>
          <span className="due-chip">In programma</span>
        </div>
        <p>{habit.goal || scheduleText(habit)}</p>
        <p className="schedule-line">
          <CalendarDays size={15} /> {scheduleText(habit)}
        </p>
        <p className="gentle-stats">
          <Flame size={14} /> Ritmo: {habit.stats.current_streak}{' '}
          {habit.stats.streak_unit === 'weeks' ? 'settimane' : 'sessioni'} · miglior{' '}
          {habit.stats.best_streak}
        </p>
        {noteOpen && (
          <label className="note-field">
            <span>Nota per oggi</span>
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Com’è andata? (facoltativo)"
              maxLength={500}
            />
          </label>
        )}
        <button className="text-button note-toggle" onClick={() => setNoteOpen((open) => !open)}>
          <NotebookPen size={16} /> {noteOpen ? 'Nascondi nota' : 'Aggiungi una nota'}
        </button>
        {habit.completed_today && noteOpen && noteChanged && (
          <button className="secondary-button note-save" disabled={busy} onClick={() => void saveNote()}>
            Salva nota
          </button>
        )}
        {actionError && (
          <p className="field-error" role="alert">
            {actionError}
          </p>
        )}
      </div>
      <button
        className={habit.completed_today ? 'completion-button done' : 'completion-button'}
        disabled={busy}
        aria-label={
          habit.completed_today
            ? `Annulla completamento ${habit.name}`
            : `Segna completata ${habit.name}`
        }
        onClick={() => void (habit.completed_today ? undo() : complete())}
      >
        {habit.completed_today ? (
          <>
            <RotateCcw size={18} /> Annulla
          </>
        ) : (
          <>
            <Check size={19} /> Segna completata
          </>
        )}
      </button>
    </article>
  );
}

function Habits({
  habits,
  onChange,
  onRemove,
  onNotice,
  navigate,
}: {
  habits: Habit[];
  onChange: (habit: Habit) => void;
  onRemove: (id: string) => void;
  onNotice: (message: string) => void;
  navigate: (page: Page) => void;
}) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'all' | HabitStatus>('all');
  const [frequency, setFrequency] = useState<'all' | ScheduleKind>('all');
  const filtered = useMemo(
    () =>
      habits.filter(
        (habit) =>
          (status === 'all' || habit.status === status) &&
          (frequency === 'all' || habit.schedule.kind === frequency) &&
          habit.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
      ),
    [habits, query, status, frequency],
  );
  return (
    <section className="page">
      <header className="page-hero compact-hero">
        <div>
          <p className="eyebrow">Il tuo spazio</p>
          <h1>Le tue abitudini</h1>
          <p className="lede">Piani flessibili, pensati per stare dentro la vita reale.</p>
        </div>
        <button className="primary-button desktop-add" onClick={() => navigate('new-habit')}>
          <Plus size={18} /> Nuova abitudine
        </button>
      </header>
      <div className="filter-bar">
        <label className="search-field">
          <Search size={18} />
          <span className="sr-only">Cerca abitudini</span>
          <input
            aria-label="Cerca abitudini"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Cerca abitudini"
          />
        </label>
        <label>
          Stato
          <select
            aria-label="Filtra per stato"
            value={status}
            onChange={(event) => setStatus(event.target.value as 'all' | HabitStatus)}
          >
            <option value="all">Tutti gli stati</option>
            <option value="active">Attive</option>
            <option value="paused">In pausa</option>
            <option value="archived">Archiviate</option>
          </select>
        </label>
        <label>
          Frequenza
          <select
            aria-label="Filtra per frequenza"
            value={frequency}
            onChange={(event) => setFrequency(event.target.value as 'all' | ScheduleKind)}
          >
            <option value="all">Tutte le frequenze</option>
            <option value="daily">Ogni giorno</option>
            <option value="weekdays">Giorni specifici</option>
            <option value="times_per_week">N volte a settimana</option>
          </select>
        </label>
      </div>
      {filtered.length ? (
        <div className="habits-list">
          {filtered.map((habit) => (
            <HabitRow
              key={habit.id}
              habit={habit}
              onChange={onChange}
              onRemove={onRemove}
              onNotice={onNotice}
            />
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <Search size={32} />
          <h2>Nessuna abitudine qui.</h2>
          <p>{habits.length ? 'Prova a cambiare ricerca o filtri.' : 'Inizia da un gesto possibile.'}</p>
          {!habits.length && (
            <button className="primary-button" onClick={() => navigate('new-habit')}>
              <Plus size={18} /> Crea un’abitudine
            </button>
          )}
        </div>
      )}
    </section>
  );
}
function HabitRow({
  habit,
  onChange,
  onRemove,
  onNotice,
}: {
  habit: Habit;
  onChange: (habit: Habit) => void;
  onRemove: (id: string) => void;
  onNotice: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const action = async (kind: 'pause' | 'resume' | 'archive' | 'restore') => {
    setBusy(true);
    try {
      const next = await api.action(habit.id, kind);
      onChange(next);
      setOpen(false);
      onNotice(
        kind === 'resume' || kind === 'restore'
          ? 'Abitudine ripresa.'
          : kind === 'pause'
            ? 'Abitudine in pausa. Nessun arretrato da recuperare.'
            : 'Abitudine archiviata.',
      );
    } catch (reason) {
      onNotice(errorText(reason));
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    setBusy(true);
    try {
      await api.deleteHabit(habit.id);
      onRemove(habit.id);
      onNotice('Abitudine eliminata definitivamente.');
    } catch (reason) {
      onNotice(errorText(reason));
    } finally {
      setBusy(false);
      setConfirmDelete(false);
    }
  };
  const icon =
    habit.status === 'active' ? (
      <Leaf size={16} />
    ) : habit.status === 'paused' ? (
      <Pause size={16} />
    ) : (
      <Archive size={16} />
    );
  return (
    <article className="habit-row">
      <div className="habit-icon" style={{ backgroundColor: `${habit.color}20`, color: habit.color }}>
        <Icon name={habit.icon} />
      </div>
      <div className="habit-row-copy">
        <div>
          <h2>{habit.name}</h2>
          <span className={`status-chip ${habit.status}`}>
            {icon}
            {habit.status === 'active'
              ? 'Attiva'
              : habit.status === 'paused'
                ? 'In pausa'
                : 'Archiviata'}
          </span>
        </div>
        <p>{habit.goal || 'Un piccolo gesto alla volta.'}</p>
        <small>
          <CalendarDays size={14} /> {scheduleText(habit)} · Inizia il{' '}
          {new Intl.DateTimeFormat('it-IT').format(new Date(`${habit.start_date}T12:00:00`))}
        </small>
        {habit.pending_schedule && (
          <small className="pending-plan">
            Dal{' '}
            {new Intl.DateTimeFormat('it-IT').format(
              new Date(`${habit.pending_schedule.effective_from}T12:00:00`),
            )}
            : {scheduleSummary(habit.pending_schedule)}
          </small>
        )}
      </div>
      <div className="row-metrics">
        <strong>{rateLabel(habit.stats.completion_rate)}</strong>
        <span>costanza</span>
      </div>
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Trigger asChild>
          <button className="icon-button" aria-label={`Azioni per ${habit.name}`}>
            <MoreHorizontal size={20} />
          </button>
        </Dialog.Trigger>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content className="dialog-content action-dialog">
            <Dialog.Title>{habit.name}</Dialog.Title>
            <Dialog.Description>
              {habit.status === 'paused'
                ? 'Una pausa non cancella il tuo percorso.'
                : 'Scegli un’azione per questo piano.'}
            </Dialog.Description>
            <div className="dialog-actions">
              <button
                disabled={busy}
                onClick={() => {
                  setOpen(false);
                  setEdit(true);
                }}
              >
                <Pencil size={17} /> Modifica
              </button>
              {habit.status === 'active' && (
                <button disabled={busy} onClick={() => void action('pause')}>
                  <Pause size={17} /> Metti in pausa
                </button>
              )}
              {habit.status === 'paused' && (
                <button disabled={busy} onClick={() => void action('resume')}>
                  <RotateCcw size={17} /> Riprendi senza colpa
                </button>
              )}
              {habit.status !== 'archived' && (
                <button disabled={busy} onClick={() => void action('archive')}>
                  <Archive size={17} /> Archivia
                </button>
              )}
              {habit.status === 'archived' && (
                <button disabled={busy} onClick={() => void action('restore')}>
                  <RotateCcw size={17} /> Ripristina
                </button>
              )}
              <button className="danger-action" disabled={busy} onClick={() => setConfirmDelete(true)}>
                <Trash2 size={17} /> Elimina definitivamente
              </button>
            </div>
            <Dialog.Close className="dialog-close" aria-label="Chiudi">
              <X size={19} />
            </Dialog.Close>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <HabitEditor habit={habit} open={edit} setOpen={setEdit} onChange={onChange} onNotice={onNotice} />
      <ConfirmDelete
        open={confirmDelete}
        setOpen={setConfirmDelete}
        name={habit.name}
        busy={busy}
        remove={remove}
      />
    </article>
  );
}
function HabitEditor({
  habit,
  open,
  setOpen,
  onChange,
  onNotice,
}: {
  habit: Habit;
  open: boolean;
  setOpen: (open: boolean) => void;
  onChange: (habit: Habit) => void;
  onNotice: (message: string) => void;
}) {
  const baselineSchedule = habit.pending_schedule ?? habit.schedule;
  const [name, setName] = useState(habit.name);
  const [goal, setGoal] = useState(habit.goal);
  const [icon, setIcon] = useState(habit.icon);
  const [color, setColor] = useState(habit.color);
  const [timezone, setTimezone] = useState(baselineSchedule.timezone);
  const [kind, setKind] = useState<ScheduleKind>(baselineSchedule.kind);
  const [weekdays, setWeekdays] = useState<number[]>(baselineSchedule.weekdays);
  const [target, setTarget] = useState(baselineSchedule.target_per_week);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (open) {
      setName(habit.name);
      setGoal(habit.goal);
      setIcon(habit.icon);
      setColor(habit.color);
      setTimezone(baselineSchedule.timezone);
      setKind(baselineSchedule.kind);
      setWeekdays(baselineSchedule.weekdays);
      setTarget(baselineSchedule.target_per_week);
      setError('');
    }
  }, [open, habit, baselineSchedule]);
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) {
      setError('Il nome è obbligatorio.');
      return;
    }
    setSaving(true);
    try {
      const scheduleChanged =
        timezone !== baselineSchedule.timezone ||
        kind !== baselineSchedule.kind ||
        (kind === 'times_per_week' && target !== baselineSchedule.target_per_week) ||
        (kind === 'weekdays' &&
          (weekdays.length !== baselineSchedule.weekdays.length ||
            weekdays.some((day) => !baselineSchedule.weekdays.includes(day))));
      const changes: Partial<HabitInput> = {
        name: name.trim(),
        goal: goal.trim(),
      };
      if (icon !== habit.icon) changes.icon = icon;
      if (color !== habit.color) changes.color = color;
      if (scheduleChanged) {
        changes.schedule = {
          kind,
          weekdays: kind === 'weekdays' ? weekdays : [],
          target_per_week: kind === 'times_per_week' ? target : 1,
          timezone,
        };
      }
      const next = await api.updateHabit(habit.id, changes);
      onChange(next);
      onNotice('Piano aggiornato. Le modifiche di frequenza entrano in vigore dal prossimo lunedì.');
      setOpen(false);
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content edit-dialog">
          <Dialog.Title>Modifica abitudine</Dialog.Title>
          <Dialog.Description>
            L'inizio rimane invariato. Frequenza e fuso cambiano dal prossimo lunedì; nome, obiettivo e
            aspetto cambiano subito.
          </Dialog.Description>
          {habit.pending_schedule && (
            <p className="pending-plan editor-pending">
              Piano già programmato dal{' '}
              {new Intl.DateTimeFormat('it-IT').format(
                new Date(`${habit.pending_schedule.effective_from}T12:00:00`),
              )}
              : {scheduleSummary(habit.pending_schedule)}. Le modifiche descrittive non lo sovrascrivono.
            </p>
          )}
          <form onSubmit={(event) => void save(event)}>
            {error && (
              <p className="field-error" role="alert">
                {error}
              </p>
            )}
            <label>
              Nome dell’abitudine
              <input maxLength={80} value={name} onChange={(event) => setName(event.target.value)} />
            </label>
            <label>
              Obiettivo
              <textarea maxLength={240} value={goal} onChange={(event) => setGoal(event.target.value)} />
            </label>
            <div className="form-split">
              <label>
                Icona
                <select value={icon} onChange={(event) => setIcon(event.target.value)}>
                  {[...new Set([habit.icon, ...iconOptions])].map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Colore
                <select value={color} onChange={(event) => setColor(event.target.value)}>
                  {[...new Set([habit.color, ...palette])].map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label>
              Fuso orario IANA
              <input
                required
                maxLength={64}
                list="habit-timezones"
                value={timezone}
                onChange={(event) => setTimezone(event.target.value)}
              />
              <datalist id="habit-timezones">
                {['Europe/Rome', 'Europe/London', 'America/New_York', 'Asia/Tokyo', 'UTC'].map(
                  (value) => (
                    <option key={value} value={value} />
                  ),
                )}
              </datalist>
            </label>
            <label>
              Frequenza
              <select value={kind} onChange={(event) => setKind(event.target.value as ScheduleKind)}>
                <option value="daily">Ogni giorno</option>
                <option value="weekdays">Giorni specifici</option>
                <option value="times_per_week">N volte a settimana</option>
              </select>
            </label>
            {kind === 'times_per_week' && (
              <label>
                Volte a settimana
                <input
                  type="number"
                  min="1"
                  max="7"
                  value={target}
                  onChange={(event) => setTarget(Number(event.target.value))}
                />
              </label>
            )}
            {kind === 'weekdays' && (
              <div>
                <span className="field-label">Giorni</span>
                <div className="weekday-choices">
                  {weekdayNames.map((day, index) => {
                    const value = index + 1;
                    const pressed = weekdays.includes(value);
                    return (
                      <button
                        type="button"
                        className={pressed ? 'selected' : ''}
                        aria-pressed={pressed}
                        key={day}
                        onClick={() =>
                          setWeekdays((days) =>
                            pressed ? days.filter((current) => current !== value) : [...days, value],
                          )
                        }
                      >
                        {day}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            <div className="button-row">
              <Dialog.Close asChild>
                <button type="button" className="secondary-button">
                  Annulla
                </button>
              </Dialog.Close>
              <button
                className="primary-button"
                disabled={saving || (kind === 'weekdays' && weekdays.length === 0)}
              >
                {saving ? 'Salvataggio…' : 'Salva modifiche'}
              </button>
            </div>
          </form>
          <Dialog.Close className="dialog-close" aria-label="Chiudi">
            <X size={19} />
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
function ConfirmDelete({
  open,
  setOpen,
  name,
  busy,
  remove,
}: {
  open: boolean;
  setOpen: (open: boolean) => void;
  name: string;
  busy: boolean;
  remove: () => Promise<void>;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content confirm-dialog">
          <Dialog.Title>Eliminare “{name}”?</Dialog.Title>
          <Dialog.Description>
            Questa azione è irreversibile e rimuove anche lo storico.
          </Dialog.Description>
          <div className="button-row">
            <Dialog.Close asChild>
              <button className="secondary-button">Annulla</button>
            </Dialog.Close>
            <button className="danger-button" disabled={busy} onClick={() => void remove()}>
              {busy ? 'Eliminazione…' : 'Elimina'}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function HabitForm({
  settings,
  onCancel,
  onSaved,
}: {
  settings: Settings;
  onCancel: () => void;
  onSaved: (habit: Habit) => void;
}) {
  const [name, setName] = useState('');
  const [goal, setGoal] = useState('');
  const [icon, setIcon] = useState('leaf');
  const [color, setColor] = useState(palette[0]);
  const [kind, setKind] = useState<ScheduleKind>('daily');
  const [weekdays, setWeekdays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [target, setTarget] = useState(3);
  const [startDate, setStartDate] = useState(today());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) {
      setError('Inserisci un nome per l’abitudine.');
      return;
    }
    setSaving(true);
    setError('');
    const input: HabitInput = {
      name: name.trim(),
      goal: goal.trim(),
      icon,
      color,
      start_date: startDate,
      schedule: {
        kind,
        weekdays: kind === 'weekdays' ? weekdays : [],
        target_per_week: kind === 'times_per_week' ? target : 1,
        timezone: settings.timezone,
      },
    };
    try {
      onSaved(await api.createHabit(input));
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setSaving(false);
    }
  };
  return (
    <section className="page form-page">
      <header className="page-hero compact-hero">
        <div>
          <p className="eyebrow">Nuovo piano</p>
          <h1>Rendila possibile.</h1>
          <p className="lede">
            Non stai promettendo perfezione: stai scegliendo un ritmo a cui tornare.
          </p>
        </div>
      </header>
      <form className="habit-form" onSubmit={(event) => void submit(event)} noValidate>
        {error && (
          <div className="inline-error" role="alert">
            {error}
          </div>
        )}
        <fieldset>
          <legend>Il gesto</legend>
          <label>
            Nome dell’abitudine <span aria-hidden="true">*</span>
            <input
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Es. Passeggiata dopo pranzo"
              maxLength={80}
            />
          </label>
          <label>
            Obiettivo{' '}
            <textarea
              value={goal}
              onChange={(event) => setGoal(event.target.value)}
              placeholder="Perché vuoi farle spazio? (facoltativo)"
              maxLength={240}
            />
          </label>
        </fieldset>
        <fieldset>
          <legend>Rendila tua</legend>
          <div className="form-split">
            <div>
              <span className="field-label">Icona</span>
              <div className="icon-choices" role="group" aria-label="Icona">
                {iconOptions.map((option) => (
                  <button
                    type="button"
                    key={option}
                    className={icon === option ? 'selected' : ''}
                    aria-pressed={icon === option}
                    aria-label={`Icona ${option}`}
                    onClick={() => setIcon(option)}
                  >
                    <Icon name={option} />
                  </button>
                ))}
              </div>
            </div>
            <div>
              <span className="field-label">Colore</span>
              <div className="color-choices" role="group" aria-label="Colore">
                {palette.map((option) => (
                  <button
                    type="button"
                    key={option}
                    className={color === option ? 'selected' : ''}
                    aria-pressed={color === option}
                    aria-label={`Colore ${option}`}
                    style={{ backgroundColor: option }}
                    onClick={() => setColor(option)}
                  >
                    <span className="sr-only">{option}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </fieldset>
        <fieldset>
          <legend>Il tuo ritmo</legend>
          <label>
            Frequenza
            <select value={kind} onChange={(event) => setKind(event.target.value as ScheduleKind)}>
              <option value="daily">Ogni giorno</option>
              <option value="weekdays">Giorni specifici</option>
              <option value="times_per_week">N volte a settimana</option>
            </select>
          </label>
          {kind === 'weekdays' && (
            <div>
              <span className="field-label">Giorni</span>
              <div className="weekday-choices">
                {weekdayNames.map((day, index) => {
                  const value = index + 1;
                  const pressed = weekdays.includes(value);
                  return (
                    <button
                      type="button"
                      className={pressed ? 'selected' : ''}
                      aria-pressed={pressed}
                      key={day}
                      onClick={() =>
                        setWeekdays((days) =>
                          pressed ? days.filter((current) => current !== value) : [...days, value],
                        )
                      }
                    >
                      {day}
                    </button>
                  );
                })}
              </div>
              {weekdays.length === 0 && <small className="field-error">Scegli almeno un giorno.</small>}
            </div>
          )}
          {kind === 'times_per_week' && (
            <label>
              Volte a settimana
              <input
                type="number"
                min="1"
                max="7"
                value={target}
                onChange={(event) => setTarget(Math.max(1, Math.min(7, Number(event.target.value))))}
              />
            </label>
          )}
          <label>
            Data di inizio
            <input
              type="date"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
            />
          </label>
          <p className="schedule-preview">
            <Sparkles size={17} />{' '}
            {kind === 'daily'
              ? 'Ogni giorno, con flessibilità.'
              : kind === 'weekdays'
                ? `Nei giorni scelti: ${weekdays.map((day) => weekdayNames[day - 1]).join(', ') || 'scegli almeno un giorno'}.`
                : `${target} volte a settimana, quando è il momento giusto.`}
          </p>
        </fieldset>
        <div className="form-footer">
          <button type="button" className="secondary-button" onClick={onCancel}>
            Annulla
          </button>
          <button
            type="submit"
            className="primary-button"
            disabled={saving || (kind === 'weekdays' && weekdays.length === 0)}
          >
            {saving ? 'Salvataggio…' : 'Salva abitudine'} <ChevronRight size={18} />
          </button>
        </div>
      </form>
    </section>
  );
}
function QuickHabit({
  onCancel,
  onCreate,
  timezone,
}: {
  onCancel: () => void;
  onCreate: () => Promise<void>;
  timezone: string;
}) {
  const [name, setName] = useState('');
  const [goal, setGoal] = useState('');
  const [icon, setIcon] = useState('leaf');
  const [color, setColor] = useState(palette[0]);
  const [kind, setKind] = useState<ScheduleKind>('daily');
  const [weekdays, setWeekdays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [target, setTarget] = useState(3);
  const [startDate, setStartDate] = useState(today());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const create = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) {
      setError('Inserisci un nome per continuare.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await api.createHabit({
        name: name.trim(),
        goal: goal.trim(),
        icon,
        color,
        start_date: startDate,
        schedule: {
          kind,
          weekdays: kind === 'weekdays' ? weekdays : [],
          target_per_week: kind === 'times_per_week' ? target : 1,
          timezone,
        },
      });
      await onCreate();
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setSaving(false);
    }
  };
  return (
    <form className="quick-habit" onSubmit={(event) => void create(event)} noValidate>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      <label>
        Nome dell’abitudine
        <input
          autoFocus
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Es. Leggere dieci pagine"
        />
      </label>
      <label>
        Obiettivo
        <textarea
          value={goal}
          onChange={(event) => setGoal(event.target.value)}
          placeholder="Perché ti importa? (facoltativo)"
        />
      </label>
      <div className="form-split">
        <label>
          Icona
          <select value={icon} onChange={(event) => setIcon(event.target.value)}>
            {iconOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        <label>
          Colore
          <select value={color} onChange={(event) => setColor(event.target.value)}>
            {palette.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="form-split">
        <label>
          Frequenza
          <select value={kind} onChange={(event) => setKind(event.target.value as ScheduleKind)}>
            <option value="daily">Ogni giorno</option>
            <option value="weekdays">Giorni specifici</option>
            <option value="times_per_week">N volte a settimana</option>
          </select>
        </label>
        {kind === 'times_per_week' && (
          <label>
            Volte
            <input
              type="number"
              min="1"
              max="7"
              value={target}
              onChange={(event) => setTarget(Number(event.target.value))}
            />
          </label>
        )}
        <label>
          Data di inizio
          <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
        </label>
      </div>
      {kind === 'weekdays' && (
        <div>
          <span className="field-label">Giorni</span>
          <div className="weekday-choices">
            {weekdayNames.map((day, index) => {
              const value = index + 1;
              const pressed = weekdays.includes(value);
              return (
                <button
                  type="button"
                  className={pressed ? 'selected' : ''}
                  aria-pressed={pressed}
                  key={day}
                  onClick={() =>
                    setWeekdays((days) =>
                      pressed ? days.filter((current) => current !== value) : [...days, value],
                    )
                  }
                >
                  {day}
                </button>
              );
            })}
          </div>
        </div>
      )}
      <div className="button-row">
        <button type="button" className="secondary-button" onClick={onCancel}>
          Indietro
        </button>
        <button
          className="primary-button"
          disabled={!name.trim() || saving || (kind === 'weekdays' && weekdays.length === 0)}
        >
          {saving ? 'Salvataggio…' : 'Inizia'} <ChevronRight size={17} />
        </button>
      </div>
    </form>
  );
}

function AnalyticsPage({ habits }: { habits: Habit[] }) {
  const [days, setDays] = useState(84);
  const [habitId, setHabitId] = useState('');
  const [reload, setReload] = useState(0);
  const [data, setData] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    void api
      .analytics(days, habitId || undefined)
      .then((next) => {
        if (alive) setData(next);
      })
      .catch((reason: unknown) => {
        if (alive) setError(errorText(reason));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [days, habitId, reload]);
  const active = habitId ? habits.find((habit) => habit.id === habitId) : null;
  return (
    <section className="page">
      <header className="page-hero compact-hero">
        <div>
          <p className="eyebrow">Dati che aiutano</p>
          <h1>Progressi, non pressione.</h1>
          <p className="lede">La costanza si legge rispetto al piano che hai scelto.</p>
        </div>
      </header>
      <div className="analytics-controls">
        <label>
          Periodo
          <select value={days} onChange={(event) => setDays(Number(event.target.value))}>
            <option value={28}>Ultime 4 settimane</option>
            <option value={84}>Ultime 12 settimane</option>
            <option value={365}>Ultimo anno</option>
          </select>
        </label>
        <label>
          Abitudine
          <select value={habitId} onChange={(event) => setHabitId(event.target.value)}>
            <option value="">Tutte le abitudini</option>
            {habits.map((habit) => (
              <option key={habit.id} value={habit.id}>
                {habit.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {loading ? (
        <div className="analytics-skeleton">
          <i />
          <i />
          <i />
        </div>
      ) : error ? (
        <InlineError message={error} retry={() => setReload((current) => current + 1)} />
      ) : data ? (
        <>
          <div className="metrics-grid">
            <Metric
              label="Costanza"
              value={rateLabel(data.completion_rate)}
              sub={
                data.expected
                  ? `${data.completed} momenti su ${data.expected} conclusi`
                  : 'Nessun periodo concluso'
              }
            />
            <Metric label="Check-in" value={String(data.total_checkins)} sub="momenti registrati" />
            <Metric
              label="Abitudini attive"
              value={String(data.active_habits)}
              sub={active ? active.name : 'nel periodo'}
            />
            {active && (
              <Metric
                label="Ritmo attuale"
                value={String(active.stats.current_streak)}
                sub={
                  active.stats.streak_unit === 'weeks' ? 'settimane consecutive' : 'sessioni consecutive'
                }
                icon={<Flame size={20} />}
              />
            )}
            {active && (
              <Metric
                label="Miglior continuità"
                value={String(active.stats.best_streak)}
                sub={
                  active.stats.streak_unit === 'weeks'
                    ? 'settimane · piano attuale'
                    : 'sessioni · piano attuale'
                }
              />
            )}
          </div>
          <section className="insight-callout">
            <Sparkles size={22} />
            <p>
              {data.completion_rate === null
                ? 'Dai tempo al tuo piano: le metriche arrivano quando esiste un periodo concluso.'
                : data.completion_rate >= 70
                  ? 'Il tuo piano sembra sostenibile. Continua a renderlo facile.'
                  : 'Ogni check-in è informazione, non un voto. Se serve, rendi il piano più leggero.'}
            </p>
          </section>
          <section className="chart-panel">
            <div className="chart-heading">
              <div>
                <span className="section-kicker">Calendario</span>
                <h2>Una traccia, non una pagella.</h2>
              </div>
              <span className="chart-legend">
                <i /> completato <i className="planned" /> giorno disponibile
              </span>
            </div>
            <p className="small-muted">
              Le serie mostrano check-in e occasioni disponibili: il tasso di costanza sopra resta
              l’unica misura rispetto al piano concluso.
            </p>
            <Heatmap data={data} />
            <details className="data-details">
              <summary>Mostra i dati del calendario in tabella</summary>
              <table>
                <thead>
                  <tr>
                    <th>Data</th>
                    <th>Completati</th>
                    <th>Occasioni disponibili</th>
                  </tr>
                </thead>
                <tbody>
                  {data.calendar.map((point) => (
                    <tr key={point.date}>
                      <td>{point.date}</td>
                      <td>{point.completed}</td>
                      <td>{point.expected}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          </section>
          <div className="chart-two-up">
            <SeriesChart title="Andamento settimanale" data={data.weekly} />
            <SeriesChart title="Andamento mensile" data={data.monthly} />
          </div>
        </>
      ) : null}
    </section>
  );
}
function Metric({
  label,
  value,
  sub,
  icon,
}: {
  label: string;
  value: string;
  sub: string;
  icon?: ReactNode;
}) {
  return (
    <article className="metric-card">
      <p>
        {icon}
        {label}
      </p>
      <strong>{value}</strong>
      <span>{sub}</span>
    </article>
  );
}
function Heatmap({ data }: { data: Analytics }) {
  const startDay = new Date(`${data.from_date}T12:00:00`).getDay();
  const leading = (startDay + 6) % 7;
  const trailing = (7 - ((leading + data.calendar.length) % 7)) % 7;
  return (
    <div
      className="heatmap"
      role="img"
      aria-label={`Calendario dal ${data.from_date} al ${data.to_date}: ${data.completed} completamenti e ${data.expected} occasioni disponibili`}
    >
      <div className="heatmap-weekdays" aria-hidden="true">
        {weekdayNames.map((day) => (
          <span key={day}>{day.slice(0, 1)}</span>
        ))}
      </div>
      <div className="heatmap-cells">
        {Array.from({ length: leading }, (_, index) => (
          <span key={`lead-${index}`} className="heat-cell empty" aria-hidden="true" />
        ))}
        {data.calendar.map((point) => {
          const level = point.completed ? 3 : point.expected ? 1 : 0;
          return (
            <span
              key={point.date}
              className={`heat-cell level-${level}`}
              title={`${point.date}: ${point.completed} completati, ${point.expected} occasioni disponibili`}
            >
              <span className="sr-only">
                {point.date}: {point.completed} completati, {point.expected} occasioni disponibili
              </span>
            </span>
          );
        })}
        {Array.from({ length: trailing }, (_, index) => (
          <span key={`tail-${index}`} className="heat-cell empty" aria-hidden="true" />
        ))}
      </div>
    </div>
  );
}
function SeriesChart({
  title,
  data,
}: {
  title: string;
  data: { label: string; completed: number; expected: number }[];
}) {
  const max = Math.max(1, ...data.map((item) => Math.max(item.completed, item.expected)));
  const compactLabel = (label: string) => {
    const week = label.match(/^\d{4}-W(\d{1,2})$/);
    if (week) return `W${week[1]}`;
    const month = label.match(/^\d{4}-(\d{2})$/);
    if (month) {
      return new Intl.DateTimeFormat('it-IT', { month: 'short' })
        .format(new Date(`2026-${month[1]}-15`))
        .replace('.', '');
    }
    return label.length > 8 ? label.slice(-5) : label;
  };
  return (
    <section className="mini-chart">
      <h2>{title}</h2>
      {data.length ? (
        <>
          <div
            className="bar-list"
            role="img"
            aria-label={`${title}: ${data.map((item) => `${item.label}, ${item.completed} completati con ${item.expected} occasioni disponibili`).join('; ')}`}
          >
            {data.map((item) => (
              <div className="bar-item" key={item.label}>
                <span
                  className={item.completed ? 'bar-value' : 'bar-value zero'}
                  style={{ height: item.completed ? `${(item.completed / max) * 100}%` : '0%' }}
                  title={`${item.label}: ${item.completed} completati, ${item.expected} occasioni disponibili`}
                />
                <span title={item.label}>{compactLabel(item.label)}</span>
              </div>
            ))}
          </div>
          <details className="data-details">
            <summary>Mostra i dati del grafico</summary>
            <table>
              <caption>{title}</caption>
              <thead>
                <tr>
                  <th>Periodo</th>
                  <th>Completati</th>
                  <th>Occasioni disponibili</th>
                </tr>
              </thead>
              <tbody>
                {data.map((item) => (
                  <tr key={item.label}>
                    <td>{item.label}</td>
                    <td>{item.completed}</td>
                    <td>{item.expected}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </>
      ) : (
        <p className="small-muted">Non ci sono ancora dati per questo intervallo.</p>
      )}
    </section>
  );
}

function SettingsPage({
  settings,
  setSettings,
  onNotice,
  onRefresh,
}: {
  settings: Settings;
  setSettings: (settings: Settings) => void;
  onNotice: (message: string) => void;
  onRefresh: () => Promise<void>;
}) {
  const [name, setName] = useState(settings.display_name);
  const [timezone, setTimezone] = useState(settings.timezone);
  const [busy, setBusy] = useState(false);
  const [importError, setImportError] = useState('');
  const save = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      const next = await api.saveSettings({ display_name: name.trim(), timezone });
      setSettings(next);
      onNotice('Impostazioni salvate. Le abitudini esistenti mantengono il loro fuso.');
    } catch (reason) {
      onNotice(errorText(reason));
    } finally {
      setBusy(false);
    }
  };
  const exportData = async () => {
    try {
      const data = await api.export();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `habitflow-backup-${today()}.json`;
      link.click();
      URL.revokeObjectURL(link.href);
      onNotice('Backup JSON scaricato.');
    } catch (reason) {
      onNotice(errorText(reason));
    }
  };
  const importData = async (file: File | undefined) => {
    if (!file) return;
    setImportError('');
    try {
      const payload: unknown = JSON.parse(await file.text());
      const result = await api.import(payload);
      await onRefresh();
      onNotice(`Importazione completata: ${result.imported} aggiunti, ${result.skipped} già presenti.`);
    } catch (reason) {
      setImportError(
        reason instanceof SyntaxError ? 'Il file non contiene JSON valido.' : errorText(reason),
      );
    }
  };
  const demo = async () => {
    try {
      const result = await api.demo();
      await onRefresh();
      onNotice(
        result.created
          ? `Dataset demo aggiunto: ${result.created} abitudini.`
          : 'Il dataset demo è già presente.',
      );
    } catch (reason) {
      onNotice(errorText(reason));
    }
  };
  return (
    <section className="page settings-page">
      <header className="page-hero compact-hero">
        <div>
          <p className="eyebrow">Il tuo spazio, i tuoi dati</p>
          <h1>Impostazioni</h1>
          <p className="lede">HabitFlow resta locale per impostazione predefinita.</p>
        </div>
      </header>
      <form className="settings-card" onSubmit={(event) => void save(event)}>
        <h2>Profilo locale</h2>
        <label>
          Nome
          <input value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <label>
          Fuso orario
          <select value={timezone} onChange={(event) => setTimezone(event.target.value)}>
            <option value={timezone}>{timezone}</option>
            <option value="Europe/Rome">Europe/Rome</option>
            <option value="Europe/London">Europe/London</option>
            <option value="America/New_York">America/New_York</option>
          </select>
        </label>
        <p className="small-muted">
          Cambiare qui il fuso influenza le nuove abitudini, non interpreta nuovamente lo storico.
        </p>
        <button className="primary-button" disabled={busy}>
          {busy ? 'Salvataggio…' : 'Salva impostazioni'}
        </button>
      </form>
      <section className="settings-card">
        <h2>Portabilità dei dati</h2>
        <p>
          Esporta un backup versionato, oppure importa dati in modo additivo: niente viene sovrascritto
          senza dirlo.
        </p>
        <div className="button-row">
          <button className="secondary-button" onClick={() => void exportData()}>
            <Download size={18} /> Esporta JSON
          </button>
          <label className="file-button">
            <Upload size={18} /> Importa JSON
            <input
              type="file"
              accept="application/json,.json"
              onChange={(event) => void importData(event.target.files?.[0])}
            />
          </label>
        </div>
        {importError && (
          <p className="field-error" role="alert">
            {importError}
          </p>
        )}
      </section>
      <section className="settings-card demo-card">
        <div>
          <h2>Esplora un esempio</h2>
          <p>Aggiunge un piccolo dataset demo senza sostituire le tue abitudini.</p>
        </div>
        <button className="secondary-button" onClick={() => void demo()}>
          <Sparkles size={18} /> Carica dataset demo
        </button>
      </section>
    </section>
  );
}
