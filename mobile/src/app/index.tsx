import { Redirect } from 'expo-router';
import { Action, Empty, Loading, Screen } from '../ui';
import { useHabits } from '../state';

export default function Entry() {
  const { settings, loading, error, refresh } = useHabits();
  if (loading) return <Loading />;
  if (error) return <Screen><Empty icon="database-alert-outline" title="Archivio non disponibile" message={error} action={<Action title="Riprova" onPress={() => void refresh()} />} /></Screen>;
  return <Redirect href={settings?.onboarding_completed ? '/(tabs)' : '/onboarding'} />;
}
