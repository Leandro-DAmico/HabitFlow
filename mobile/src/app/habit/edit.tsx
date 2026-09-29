import { useLocalSearchParams } from 'expo-router';
import HabitForm from '../../HabitForm';
import { useHabits } from '../../state';
import { Empty, Screen } from '../../ui';
export default function EditHabit() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const habit = useHabits().habits.find((item) => item.id === id);
  if (!habit) return <Screen><Empty icon="alert-circle-outline" title="Abitudine non trovata" message="Torna all’elenco e riprova." /></Screen>;
  return <HabitForm habit={habit} />;
}
