import { useCallback, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { recoveryReminderPreferenceKey } from '../../../lib/recovery-code-reminder';
import { createReminderPreference, type ReminderPreferenceState } from '@/lib/recovery-reminder-preference';

const initial: ReminderPreferenceState = { enabled: false, loading: true, saving: false, error: false };

export function useRecoveryReminderPreference(userId: number | null) {
  const [snapshot, setSnapshot] = useState<{ userId: number | null; state: ReminderPreferenceState }>({
    userId: null, state: initial,
  });
  const currentUser = useRef(userId);
  currentUser.current = userId;
  const session = useRef<ReturnType<typeof createReminderPreference> | null>(null);

  useEffect(() => {
    if (userId === null) return;
    const preference = createReminderPreference(AsyncStorage, recoveryReminderPreferenceKey(userId), state => {
      if (currentUser.current === userId) setSnapshot({ userId, state });
    });
    session.current = preference;
    void preference.load();
    return () => {
      preference.dispose();
      if (session.current === preference) session.current = null;
    };
  }, [userId]);

  const state = snapshot.userId === userId && userId !== null ? snapshot.state : initial;
  const setEnabled = useCallback((enabled: boolean) => {
    if (userId !== null && snapshot.userId === userId && !snapshot.state.loading) {
      void session.current?.setEnabled(enabled);
    }
  }, [userId, snapshot]);
  return { ...state, setEnabled };
}