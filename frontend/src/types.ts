export type ScheduleKind = 'daily' | 'weekdays' | 'times_per_week';
export type HabitStatus = 'active' | 'paused' | 'archived';

export interface Schedule {
  kind: ScheduleKind;
  weekdays: number[];
  target_per_week: number;
  timezone: string;
  effective_from: string;
}

export interface Stats {
  current_streak: number;
  best_streak: number;
  streak_unit: 'sessions' | 'weeks';
  completed: number;
  expected: number;
  completion_rate: number | null;
  total_checkins: number;
  week_completed: number;
  week_target: number;
}

export interface Habit {
  id: string;
  name: string;
  goal: string;
  icon: string;
  color: string;
  start_date: string;
  status: HabitStatus;
  schedule: Schedule;
  pending_schedule: Schedule | null;
  today: string;
  is_due: boolean;
  completed_today: boolean;
  note_today: string;
  stats: Stats;
}

export interface Settings {
  display_name: string;
  timezone: string;
  onboarding_completed: boolean;
}
export interface CalendarPoint {
  date: string;
  completed: number;
  expected: number;
}
export interface SeriesPoint {
  label: string;
  completed: number;
  expected: number;
}
export interface Analytics {
  from_date: string;
  to_date: string;
  completed: number;
  expected: number;
  completion_rate: number | null;
  total_checkins: number;
  active_habits: number;
  calendar: CalendarPoint[];
  weekly: SeriesPoint[];
  monthly: SeriesPoint[];
  habits: Habit[];
}
export interface HabitInput {
  name: string;
  goal: string;
  icon: string;
  color: string;
  start_date: string;
  schedule: Omit<Schedule, 'effective_from'>;
}
