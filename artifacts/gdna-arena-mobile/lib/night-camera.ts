import { useSyncExternalStore } from 'react';
import type { IRtcEngine } from 'react-native-agora';
import { inactiveNightCamera, NightCameraController } from './night-camera-controller';

let attached: { callId: string; controller: NightCameraController } | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach(listener => listener());
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

/** Attach only after initialize; the controller waits for Agora's capture callback. */
export function attachNightCamera(engine: IRtcEngine, callId: string): void {
  detachNightCamera();
  attached = { callId, controller: new NightCameraController(engine, notify) };
  notify();
}

/** Detach before engine.release; a stale call ID cannot detach a newer call. */
export function detachNightCamera(callId?: string): void {
  if (!attached || (callId && attached.callId !== callId)) return;
  attached.controller.dispose();
  attached = null;
  notify();
}

export function useNightCamera(callId: string | null) {
  const state = useSyncExternalStore(subscribe, () =>
    callId && attached?.callId === callId ? attached.controller.snapshot : inactiveNightCamera);
  const available = !!callId && attached?.callId === callId;
  return {
    state, available,
    setNight: (enabled: boolean) => { if (available) attached?.controller.setNight(enabled); },
    setTorch: (enabled: boolean) => { if (available) attached?.controller.setTorch(enabled); },
    switchCamera: () => { if (available) attached?.controller.switchCamera(); },
  };
}