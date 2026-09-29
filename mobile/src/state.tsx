import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { useSQLiteContext, type SQLiteDatabase } from 'expo-sqlite';
import { readHabits, readSettings } from './store';
import type { HabitData, Settings } from './types';

type State = {
  db: SQLiteDatabase;
  settings: Settings | null;
  habits: HabitData[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
};

const Context = createContext<State | null>(null);

export function HabitProvider({ children }: { children: ReactNode }) {
  const db = useSQLiteContext();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [habits, setHabits] = useState<HabitData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    try {
      const [nextSettings, nextHabits] = await Promise.all([readSettings(db), readHabits(db)]);
      setSettings(nextSettings);
      setHabits(nextHabits);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Impossibile aprire l’archivio locale.');
    } finally {
      setLoading(false);
    }
  }, [db]);
  useEffect(() => {
    const frame = requestAnimationFrame(() => { void refresh(); });
    const sub = AppState.addEventListener('change', (value) => { if (value === 'active') void refresh(); });
    return () => { cancelAnimationFrame(frame); sub.remove(); };
  }, [refresh]);
  return <Context.Provider value={{ db, settings, habits, loading, error, refresh }}>{children}</Context.Provider>;
}

export function useHabits() {
  const state = useContext(Context);
  if (!state) throw new Error('HabitProvider mancante.');
  return state;
}
