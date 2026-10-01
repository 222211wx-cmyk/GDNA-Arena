export type ReminderPreferenceState = {
  enabled: boolean;
  loading: boolean;
  saving: boolean;
  error: boolean;
};

type Storage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<unknown>;
};

// Serialize device operations per account, including across screen remounts.
// A returning account must not read before its previous pending write settles.
const pending = new Map<string, Promise<unknown>>();
function enqueue<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const result = (pending.get(key) ?? Promise.resolve()).catch(() => {}).then(operation);
  pending.set(key, result);
  void result.finally(() => {
    if (pending.get(key) === result) pending.delete(key);
  }).catch(() => {});
  return result;
}

export function createReminderPreference(
  storage: Storage,
  key: string,
  onChange: (state: ReminderPreferenceState) => void,
) {
  let disposed = false;
  let state: ReminderPreferenceState = { enabled: false, loading: true, saving: false, error: false };
  const publish = (next: ReminderPreferenceState) => {
    if (disposed) return;
    state = next;
    onChange(state);
  };
  const load = async () => {
    publish(state);
    try {
      const value = await enqueue(key, () => storage.getItem(key));
      if (value !== null && value !== 'true' && value !== 'false') throw new Error('Invalid reminder preference');
      publish({ enabled: value === 'true', loading: false, saving: false, error: false });
    } catch {
      publish({ enabled: false, loading: false, saving: false, error: true });
    }
  };
  const setEnabled = async (enabled: boolean) => {
    if (disposed || state.loading || state.saving) return;
    publish({ ...state, saving: true, error: false });
    try {
      await enqueue(key, () => storage.setItem(key, String(enabled)));
      publish({ enabled, loading: false, saving: false, error: false });
    } catch {
      // Never claim a failed save succeeded or persist anything sensitive.
      publish({ ...state, saving: false, error: true });
    }
  };
  return { load, setEnabled, dispose: () => { disposed = true; } };
}