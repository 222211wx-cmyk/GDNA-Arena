import { inactiveNightCamera } from './night-camera-controller';

export function attachNightCamera(): void {}
export function detachNightCamera(): void {}

export function useNightCamera(_callId: string | null) {
  return {
    state: inactiveNightCamera, available: false,
    setNight: (_enabled: boolean) => {},
    setTorch: (_enabled: boolean) => {},
    switchCamera: () => {},
  };
}