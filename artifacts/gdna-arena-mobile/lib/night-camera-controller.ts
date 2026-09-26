import type { IRtcEngine, IRtcEngineEventHandler } from 'react-native-agora';

// Agora 4.6.2: LocalVideoStreamStateCapturing = 1; see AgoraBase.ts.
// The enum is intentionally not imported at runtime so this controller can be
// exercised without loading native modules.
const CAMERA_CAPTURING = 1;
const PRIMARY_CAMERA = 0;

export type NightCameraState = {
  ready: boolean;
  torchSupported: boolean;
  nightEnabled: boolean;
  torchEnabled: boolean;
  error: string | null;
};

export const inactiveNightCamera: NightCameraState = {
  ready: false, torchSupported: false, nightEnabled: false, torchEnabled: false, error: null,
};

export class NightCameraController {
  private state: NightCameraState = inactiveNightCamera;
  private readonly handler: IRtcEngineEventHandler;
  private closed = false;

  constructor(private readonly engine: IRtcEngine, private readonly notify: () => void) {
    this.handler = {
      onLocalVideoStateChanged: (source, state, reason) => {
        if (this.closed || source !== PRIMARY_CAMERA) return;
        if (state === CAMERA_CAPTURING) {
          try {
            this.update({ ready: true, torchSupported: engine.isCameraTorchSupported(), error: null });
          } catch (cause) {
            this.update({ ready: true, torchSupported: false, error: this.message(cause, 'Could not check flashlight support.') });
          }
        } else if (state === 0 || state === 3) {
          this.update({
            ready: false, torchSupported: false, torchEnabled: false,
            error: state === 3 ? `Camera capture failed (Agora reason ${reason}). Check camera permission and device availability.` : null,
          });
        }
      },
    };
    try {
      if (!engine.registerEventHandler(this.handler)) {
        this.update({ error: 'Could not observe Agora camera capture state.' });
      }
    } catch (cause) {
      this.update({ error: this.message(cause, 'Could not observe Agora camera capture state.') });
    }
  }

  get snapshot(): NightCameraState { return this.state; }

  private update(change: Partial<NightCameraState>) {
    this.state = { ...this.state, ...change };
    this.notify();
  }

  private message(cause: unknown, fallback: string) {
    return cause instanceof Error ? `${fallback} ${cause.message}` : fallback;
  }

  setNight(enabled: boolean): void {
    if (this.closed || !this.state.ready) { this.update({ error: 'Camera is not capturing yet.' }); return; }
    try {
      // Fast level avoids the denoiser prerequisite of high-quality mode.
      const result = this.engine.setLowlightEnhanceOptions(enabled, { mode: 0, level: 1 });
      if (result !== 0) {
        this.update({ error: `Agora low-light enhancement is unavailable on this device (${result}).` });
        return;
      }
      this.update({ nightEnabled: enabled, error: null });
    } catch (cause) {
      this.update({ error: this.message(cause, 'Could not change low-light enhancement.') });
    }
  }

  setTorch(enabled: boolean): void {
    if (this.closed || !this.state.ready) { this.update({ error: 'Camera is not capturing yet.' }); return; }
    if (enabled && !this.state.torchSupported) {
      this.update({ error: 'Flashlight is not supported by this camera. Try the rear camera.' });
      return;
    }
    try {
      const result = this.engine.setCameraTorchOn(enabled);
      if (result !== 0) {
        this.update({ error: `Agora could not ${enabled ? 'turn on' : 'turn off'} the flashlight (${result}).` });
        return;
      }
      this.update({ torchEnabled: enabled, error: null });
    } catch (cause) {
      this.update({ error: this.message(cause, 'Could not change the flashlight.') });
    }
  }

  switchCamera(): void {
    if (this.closed || !this.state.ready) { this.update({ error: 'Camera is not capturing yet.' }); return; }
    try {
      if (this.state.torchEnabled) {
        const off = this.engine.setCameraTorchOn(false);
        if (off !== 0) { this.update({ error: `Agora could not turn off the flashlight (${off}).` }); return; }
      }
      const result = this.engine.switchCamera();
      if (result !== 0) {
        this.update({ torchEnabled: false, error: `Agora could not switch cameras (${result}).` });
        return;
      }
      // Torch support is camera-specific. Wait for the new camera's capture event.
      this.update({ ready: false, torchSupported: false, torchEnabled: false, error: null });
    } catch (cause) {
      this.update({ error: this.message(cause, 'Could not switch cameras.') });
    }
  }

  dispose(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.state.torchEnabled) {
      try { this.engine.setCameraTorchOn(false); } catch { /* engine is being released */ }
    }
    if (this.state.nightEnabled) {
      try { this.engine.setLowlightEnhanceOptions(false, { mode: 0, level: 1 }); } catch { /* engine is being released */ }
    }
    try { this.engine.unregisterEventHandler(this.handler); } catch { /* engine is being released */ }
  }
}