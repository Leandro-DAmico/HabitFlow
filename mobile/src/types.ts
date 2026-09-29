export type ScheduleKind = 'daily' | 'weekdays' | 'times_per_week';
export type HabitStatus = 'active' | 'paused' | 'archived';

export type Settings = {
  display_name: string;
  timezone: string;
  onboarding_completed: boolean;
};

export type Habit = {
  id: string;
  name: string;
  goal: string;
  icon: string;
  color: string;
  start_date: string;
  status: HabitStatus;
  archived_on: string | null;
  created_at: string;
  updated_at: string;
};

export type Schedule = {
  id: string;
  habit_id: string;
  kind: ScheduleKind;
  weekdays: number[];
  target_per_week: number;
  timezone: string;
  effective_from: string;
  created_at: string;
};

export type Pause = {
  id: string;
  habit_id: string;
  start_date: string;
  end_date: string | null;
  created_at: string;
};

export type Checkin = {
  id: string;
  habit_id: string;
  schedule_id: string;
  occurrence_date: string;
  completed_at: string;
  timezone: string;
  note: string;
};

export type HabitData = Habit & {
  schedules: Schedule[];
  pauses: Pause[];
  checkins: Checkin[];
};

export type Backup = {
  format: 'habitflow-backup';
  version: 1;
  exported_at: string;
  settings: Settings;
  habits: Habit[];
  schedules: Schedule[];
  pauses: Pause[];
  checkins: Checkin[];
};

export type HabitDraft = {
  name: string;
  goal: string;
  icon: string;
  color: string;
  start_date: string;
  kind: ScheduleKind;
  weekdays: number[];
  target_per_week: number;
  timezone: string;
};
