import type { HabitData, Schedule } from './types';

const DAY = 86_400_000;
export const dateAt = (day: string) => new Date(`${day}T12:00:00.000Z`);
export const addDays = (day: string, offset: number) =>
  new Date(dateAt(day).getTime() + offset * DAY).toISOString().slice(0, 10);
export const isoDay = (day: string) => ((dateAt(day).getUTCDay() + 6) % 7) + 1;
export const monday = (day: string) => addDays(day, 1 - isoDay(day));
export const nextMonday = (day: string) => addDays(day, 8 - isoDay(day));
export const localToday = (timezone: string, now = new Date()) => {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const part = (kind: 'year' | 'month' | 'day') => parts.find((item) => item.type === kind)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
};

export function scheduleAt(habit: HabitData, day: string): Schedule | undefined {
  return [...habit.schedules]
    .sort((a, b) => a.effective_from.localeCompare(b.effective_from))
    .filter((item) => item.effective_from <= day)
    .at(-1);
}

export function habitToday(habit: HabitData, now = new Date()) {
  const plans = [...habit.schedules].sort((a, b) => a.effective_from.localeCompare(b.effective_from));
  if (!plans.length) return localToday('UTC', now);
  let selected = plans[0];
  for (const plan of plans) {
    if (plan.effective_from <= localToday(plan.timezone, now)) selected = plan;
  }
  const selectedDay = localToday(selected.timezone, now);
  const pending = plans.find((item) => item.effective_from > selected.effective_from);
  if (pending && selectedDay >= pending.effective_from && localToday(pending.timezone, now) < pending.effective_from) {
    return addDays(pending.effective_from, -1);
  }
  return selectedDay;
}

export function eligible(habit: HabitData, day: string) {
  if (day < habit.start_date) return false;
  const schedule = scheduleAt(habit, day);
  if (!schedule) return false;
  if (schedule.kind === 'weekdays' && !schedule.weekdays.includes(isoDay(day))) return false;
  if (habit.checkins.some((item) => item.occurrence_date === day)) return true;
  return !habit.pauses.some((pause) => pause.start_date <= day && (!pause.end_date || day < pause.end_date));
}

export function isDue(habit: HabitData, now = new Date()) {
  if (habit.status !== 'active') return false;
  const day = habitToday(habit, now);
  if (!eligible(habit, day) || habit.checkins.some((item) => item.occurrence_date === day)) return false;
  const schedule = scheduleAt(habit, day);
  if (schedule?.kind !== 'times_per_week') return true;
  const start = monday(day);
  const count = habit.checkins.filter((item) => item.occurrence_date >= start && item.occurrence_date <= day).length;
  return count < schedule.target_per_week;
}

export type Stats = {
  current: number;
  best: number;
  unit: 'sessioni' | 'settimane';
  completed: number;
  expected: number;
  rate: number | null;
  total: number;
  weekCompleted: number;
  weekTarget: number;
};

const allDays = (start: string, end: string) => {
  const result: string[] = [];
  for (let day = start; day <= end; day = addDays(day, 1)) result.push(day);
  return result;
};

function weeklyBucket(habit: HabitData, week: string, today: string, segmentStart: string) {
  const end = addDays(week, 6);
  let target = 0;
  let capacity = 0;
  let completed = 0;
  for (const day of allDays(week, end)) {
    if (day < habit.start_date || day < segmentStart) continue;
    const schedule = scheduleAt(habit, day);
    if (schedule?.kind !== 'times_per_week') continue;
    if (!target) target = schedule.target_per_week;
    if (schedule.target_per_week !== target || !eligible(habit, day)) continue;
    capacity++;
    if (day <= today && habit.checkins.some((item) => item.occurrence_date === day)) completed++;
  }
  return { target: Math.min(target, capacity), completed, open: week <= today && today <= end };
}

export function stats(habit: HabitData, today = habitToday(habit), from = habit.start_date, to = today): Stats {
  const schedule = scheduleAt(habit, today) ?? habit.schedules[0];
  const weekly = schedule?.kind === 'times_per_week';
  const unit = weekly ? 'settimane' : 'sessioni';
  const checked = new Set(habit.checkins.map((item) => item.occurrence_date));
  const boundedFrom = from > habit.start_date ? from : habit.start_date;
  const boundedTo = to < today ? to : today;
  let completed = 0;
  let expected = 0;
  let total = 0;
  if (boundedFrom <= boundedTo) {
    for (const day of allDays(boundedFrom, boundedTo)) {
      if (!eligible(habit, day)) continue;
      if (checked.has(day)) total++;
      if (scheduleAt(habit, day)?.kind !== 'times_per_week' && day < today) {
        expected++;
        if (checked.has(day)) completed++;
      }
    }
    for (let week = monday(boundedFrom); week <= boundedTo; week = addDays(week, 7)) {
      const sunday = addDays(week, 6);
      if (sunday < boundedFrom || sunday > boundedTo || sunday >= today) continue;
      const bucket = weeklyBucket(habit, week, today, habit.start_date);
      expected += bucket.target;
      completed += Math.min(bucket.completed, bucket.target);
    }
  }
  let segmentStart = habit.start_date;
  const family = (item: Schedule) => item.kind === 'times_per_week';
  for (const item of [...habit.schedules].sort((a, b) => a.effective_from.localeCompare(b.effective_from))) {
    if (item.effective_from > today) break;
    if (family(item) === weekly) continue;
    const next = habit.schedules.find((candidate) => candidate.effective_from > item.effective_from && family(candidate) === weekly);
    if (next && next.effective_from <= today) segmentStart = next.effective_from;
  }
  let current = 0;
  let best = 0;
  let running = 0;
  const values: (boolean | null)[] = [];
  if (weekly) {
    for (let week = monday(segmentStart); week <= today; week = addDays(week, 7)) {
      const bucket = weeklyBucket(habit, week, today, segmentStart);
      values.push(bucket.target === 0 ? null : bucket.open && bucket.completed < bucket.target ? null : bucket.completed >= bucket.target);
    }
  } else {
    for (const day of allDays(segmentStart, today)) {
      if (scheduleAt(habit, day)?.kind === 'times_per_week' || !eligible(habit, day)) continue;
      values.push(day === today && !checked.has(day) ? null : checked.has(day));
    }
  }
  for (const value of values) {
    if (value === null) continue;
    running = value ? running + 1 : 0;
    best = Math.max(best, running);
  }
  for (const value of [...values].reverse()) {
    if (value === null) continue;
    if (!value) break;
    current++;
  }
  const week = monday(today);
  const weekDays = allDays(week, addDays(week, 6)).filter((day) => eligible(habit, day));
  const weekCompleted = weekDays.filter((day) => day <= today && checked.has(day)).length;
  const weekTarget = weekly ? Math.min(schedule?.target_per_week ?? 0, weekDays.length) : weekDays.length;
  return { current, best, unit, completed, expected, rate: expected ? Math.round(completed / expected * 1000) / 10 : null, total, weekCompleted, weekTarget };
}

export function scheduleLabel(schedule: Schedule) {
  if (schedule.kind === 'daily') return 'Ogni giorno';
  if (schedule.kind === 'times_per_week') return `${schedule.target_per_week} volte a settimana`;
  return schedule.weekdays.map((day) => ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'][day - 1]).join(' · ');
}

export function monthGrid(habit: HabitData, year: number, month: number, today = habitToday(habit)) {
  const first = `${year}-${String(month + 1).padStart(2, '0')}-01`;
  const length = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const cells: { date: string; planned: boolean; completed: boolean; future: boolean }[] = [];
  for (let offset = 1; offset < isoDay(first); offset++) cells.push({ date: '', planned: false, completed: false, future: false });
  for (let number = 1; number <= length; number++) {
    const day = `${year}-${String(month + 1).padStart(2, '0')}-${String(number).padStart(2, '0')}`;
    cells.push({ date: day, planned: day <= today && eligible(habit, day), completed: habit.checkins.some((checkin) => checkin.occurrence_date === day), future: day > today });
  }
  return cells;
}
