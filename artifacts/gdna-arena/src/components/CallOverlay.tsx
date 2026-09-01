// ══════════════════════════════════════════════════════════════════════════════
//  CallOverlay — Full-screen voice/video call UI
// ══════════════════════════════════════════════════════════════════════════════

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Phone, PhoneOff, Video, VideoOff, Mic, MicOff,
  Volume2, VolumeX, Minimize2, Monitor, MonitorOff, Settings2
} from "lucide-react";
import type { CallDevice, CallDeviceIssue, CallDeviceKind, CallStatus } from "@/hooks/useCall";
import { SOCIAL_T } from "@/components/social/social-i18n";
import { useLang } from "@/contexts/LangContext";
import { Button } from "@workspace/gdna-ds/components/ui/button";
import { Label } from "@workspace/gdna-ds/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/gdna-ds/components/ui/select";

interface Props {
  status:         CallStatus;
  peer:           string | null;
  localStream:    MediaStream | null;
  remoteStream:   MediaStream | null;
  incomingCall:   { from: string; video: boolean } | null;
  onAnswer:       (video: boolean) => void;
  onReject:       () => void;
  onEnd:          () => void;
  screenSharing?: boolean;
  onScreenShare?: () => void;
  onStopScreen?:  () => void;
  callError?:     string | null;
  devices?: CallDevice[];
  selectedMicrophoneId?: string;
  selectedCameraId?: string;
  selectedSpeakerId?: string;
  speakerSelectionSupported?: boolean;
  deviceIssue?: CallDeviceIssue | null;
  switchingDevice?: CallDeviceKind | null;
  onRefreshDevices?: () => Promise<CallDevice[] | undefined>;
  onSwitchMicrophone?: (deviceId: string) => Promise<void>;
  onSwitchCamera?: (deviceId: string) => Promise<void>;
  onSelectSpeaker?: (deviceId: string) => void;
  onSpeakerFailure?: () => void;
}

export default function CallOverlay({
  status, peer, localStream, remoteStream, incomingCall, onAnswer, onReject, onEnd,
  screenSharing = false, onScreenShare, onStopScreen, callError,
  devices = [], selectedMicrophoneId = "", selectedCameraId = "", selectedSpeakerId = "",
  speakerSelectionSupported = false, deviceIssue = null, switchingDevice = null,
  onRefreshDevices = async () => undefined, onSwitchMicrophone = async () => undefined,
  onSwitchCamera = async () => undefined, onSelectSpeaker = () => undefined,
  onSpeakerFailure = () => undefined,
}: Props) {
  const { lang } = useLang();
  const st = SOCIAL_T[lang] ?? SOCIAL_T.en;
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const localVideoRef  = useRef<HTMLVideoElement>(null);
  const [muted,       setMuted]       = useState(false);
  const [videoOff,    setVideoOff]    = useState(false);
  const [speakerOff,  setSpeakerOff]  = useState(false);
  const [minimized,   setMinimized]   = useState(false);
  const [duration,    setDuration]    = useState(0);
  const [playbackBlocked, setPlaybackBlocked] = useState(false);
  const [devicePickerOpen, setDevicePickerOpen] = useState(false);

  // Attach streams to video elements
  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream;
      void remoteVideoRef.current.play()
        .then(() => setPlaybackBlocked(false))
        .catch(() => setPlaybackBlocked(true));
    }
  }, [remoteStream]);

  useEffect(() => {
    const player = remoteVideoRef.current;
    if (!player || !selectedSpeakerId || !speakerSelectionSupported) return;
    const sinkPlayer = player as HTMLVideoElement & { setSinkId: (deviceId: string) => Promise<void> };
    void sinkPlayer.setSinkId(selectedSpeakerId).catch(onSpeakerFailure);
  }, [remoteStream, selectedSpeakerId, speakerSelectionSupported, minimized, onSpeakerFailure]);

  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  // Mute local audio
  useEffect(() => {
    localStream?.getAudioTracks().forEach(t => { t.enabled = !muted; });
  }, [muted, localStream]);

  // Disable local video
  useEffect(() => {
    localStream?.getVideoTracks().forEach(t => { t.enabled = !videoOff; });
  }, [videoOff, localStream]);

  // Call timer
  useEffect(() => {
    if (status !== "active") { setDuration(0); return; }
    const t = setInterval(() => setDuration(d => d + 1), 1000);
    return () => clearInterval(t);
  }, [status]);

  useEffect(() => {
    if (status === "calling" || status === "ringing") {
      setMuted(false);
      setVideoOff(false);
      setSpeakerOff(false);
      setMinimized(false);
      setPlaybackBlocked(false);
      setDevicePickerOpen(false);
    }
  }, [status, peer, incomingCall?.from]);

  const formatDuration = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

  const hasVideo = !!(localStream?.getVideoTracks().length);
  const microphones = devices.filter(device => device.kind === "audioinput");
  const cameras = devices.filter(device => device.kind === "videoinput");
  const speakers = devices.filter(device => device.kind === "audiooutput");

  // ── Call error toast (shown even when idle) ────────────────────────────────
  if (status === "idle") {
    if (!callError) return null;
    return (
      <AnimatePresence>
        <motion.div
          initial={{ opacity: 0, y: 60 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 60 }}
          style={{
            position: "fixed", bottom: 90, left: "50%", transform: "translateX(-50%)",
            zIndex: 9999, background: "hsl(var(--destructive) / 0.1)", border: "1px solid hsl(var(--destructive) / 0.5)",
            borderRadius: 14, padding: "14px 22px", maxWidth: 400, width: "90vw",
            display: "flex", alignItems: "center", gap: 12,
            boxShadow: "0 8px 32px hsl(var(--destructive) / 0.2)",
          }}>
          <span style={{ fontSize: 22 }}>📵</span>
          <p style={{ margin: 0, color: "hsl(var(--destructive))", fontWeight: 700, fontSize: 13, lineHeight: 1.4 }}>
            {callError}
          </p>
        </motion.div>
      </AnimatePresence>
    );
  }

  // ── Incoming call ring ─────────────────────────────────────────────────────
  if (status === "ringing" && incomingCall) return (
    <AnimatePresence>
      <motion.div initial={{ opacity: 0, y: 80 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 80 }}
        className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[9999] rounded-2xl overflow-hidden shadow-2xl"
        style={{ width: 320, background: "hsl(var(--card))", border: "1px solid hsl(var(--primary) / 0.4)" }}>

        {/* Pulse ring */}
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute inset-0 animate-ping rounded-2xl opacity-10" style={{ background: "#22c55e" }} />
        </div>

        <div className="relative p-5 space-y-4">
          <div className="text-center space-y-1">
            <div className="w-16 h-16 rounded-full mx-auto flex items-center justify-center font-black text-2xl text-black"
              style={{ background: "linear-gradient(135deg, #C9A84C, #FFD700)" }}>
              {incomingCall.from.charAt(0).toUpperCase()}
            </div>
            <p className="font-black text-white text-lg">{incomingCall.from}</p>
            <p className="text-xs font-mono animate-pulse" style={{ color: "#22c55e" }}>
               {incomingCall.video ? `📹 ${st.incoming_video_call}` : `📞 ${st.incoming_voice_call}`}
            </p>
          </div>

          <div className="flex justify-center gap-6">
            {/* Reject */}
            <button onClick={onReject}
              aria-label={st.reject_call}
              className="w-14 h-14 rounded-full flex items-center justify-center transition-all active:scale-95"
              style={{ background: "hsl(var(--destructive))" }}>
              <PhoneOff className="w-6 h-6 text-white" />
            </button>

            {/* Answer audio */}
            {incomingCall.video && (
              <button onClick={() => onAnswer(false)}
                aria-label={st.answer_voice}
                className="w-14 h-14 rounded-full flex items-center justify-center transition-all active:scale-95"
                style={{ background: "#3b82f6" }}>
                <Phone className="w-6 h-6 text-white" />
              </button>
            )}

            {/* Answer video */}
            <button onClick={() => onAnswer(incomingCall.video)}
              aria-label={incomingCall.video ? st.answer_video : st.answer_voice}
              className="w-14 h-14 rounded-full flex items-center justify-center transition-all active:scale-95"
              style={{ background: "#22c55e" }}>
              {incomingCall.video ? <Video className="w-6 h-6 text-white" /> : <Phone className="w-6 h-6 text-white" />}
            </button>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );

  // ── Active call / calling / ended ──────────────────────────────────────────
  if (minimized) return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
      className="fixed bottom-6 right-6 z-[9999] rounded-2xl cursor-pointer overflow-hidden shadow-2xl"
      style={{ width: 200, height: 112, background: "hsl(var(--background))", border: "1px solid hsl(var(--primary) / 0.4)" }}
      onClick={() => setMinimized(false)}>
      {remoteStream
        ? <video ref={remoteVideoRef} autoPlay playsInline className="w-full h-full object-cover" muted={speakerOff} />
        : <div className="w-full h-full flex items-center justify-center">
            <div className="text-center space-y-1">
              <div className="w-10 h-10 rounded-full mx-auto flex items-center justify-center font-black text-sm text-black"
                style={{ background: "hsl(var(--primary))" }}>{peer?.charAt(0).toUpperCase()}</div>
              <p className="text-[10px] font-mono" style={{ color: "hsl(var(--primary))" }}>
                {status === "calling" ? st.calling : status === "active" ? formatDuration(duration) : st.call_ended}
              </p>
            </div>
          </div>}
      <div className="absolute top-2 right-2">
        <button onClick={(e) => { e.stopPropagation(); onEnd(); }}
          className="w-7 h-7 rounded-full flex items-center justify-center" style={{ background: "hsl(var(--destructive))" }}>
          <PhoneOff className="w-3 h-3 text-white" />
        </button>
      </div>
    </motion.div>
  );

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
      className="fixed inset-0 z-[9998] flex flex-col"
      style={{ background: "hsl(var(--background))" }}>

      {/* Remote video / avatar */}
      <div className="flex-1 min-h-0 relative flex items-center justify-center overflow-hidden">
        {remoteStream ? (
          <video id="remote-player" ref={remoteVideoRef} autoPlay playsInline className="w-full h-full object-cover" muted={speakerOff} />
        ) : (
          <div className="text-center space-y-4">
            <div className="w-28 h-28 rounded-full mx-auto flex items-center justify-center font-black text-5xl text-black"
              style={{ background: "linear-gradient(135deg, #C9A84C, #FFD700)" }}>
              {peer?.charAt(0).toUpperCase() ?? "?"}
            </div>
            <div className="space-y-1">
              <p className="text-white font-black text-2xl">{peer}</p>
              <p className="text-sm font-mono animate-pulse" style={{ color: status === "active" ? "#22c55e" : "hsl(var(--primary))" }}>
                 {status === "calling"  ? `⏳ ${st.calling}`
                 : status === "active"  ? `✅ ${st.connected} — ${formatDuration(duration)}`
                 : status === "ended"   ? `📵 ${st.call_ended}`
                : ""}
              </p>
            </div>
          </div>
        )}

        {/* Timer overlay when video active */}
        {remoteStream && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full text-xs font-mono"
            style={{ background: "rgba(0,0,0,0.6)", color: "#22c55e" }}>
            {peer} · {formatDuration(duration)}
          </div>
        )}

        {playbackBlocked && remoteStream && (
          <button
            type="button"
            onClick={() => {
              void remoteVideoRef.current?.play()
                .then(() => setPlaybackBlocked(false))
                .catch(() => setPlaybackBlocked(true));
            }}
            className="absolute bottom-28 left-1/2 -translate-x-1/2 rounded-full border border-primary/40 bg-card px-4 py-2 text-sm font-bold text-primary"
          >
            اضغط لتشغيل صوت المكالمة
          </button>
        )}

        {callError && (
          <div
            role="alert"
            className="absolute top-16 left-1/2 -translate-x-1/2 rounded-xl border px-4 py-3 text-center text-sm font-bold"
            style={{
              width: "min(90vw, 520px)",
              background: "hsl(var(--card) / 0.96)",
              borderColor: "hsl(var(--destructive) / 0.55)",
              color: "hsl(var(--destructive))",
            }}
          >
            {callError}
          </div>
        )}

        {deviceIssue && (
          <div
            role="alert"
            data-testid="status-device-disconnected"
            className="absolute top-28 left-1/2 -translate-x-1/2 rounded-xl border border-destructive/50 bg-card/95 p-4 text-center text-sm font-bold text-destructive"
            style={{ width: "min(90vw, 520px)" }}
          >
            <p>{deviceIssue.message}</p>
            <Button
              data-testid="button-recover-device"
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => { setDevicePickerOpen(true); void onRefreshDevices(); }}
            >
              اختر جهازاً آخر
            </Button>
          </div>
        )}

        {/* Local video (PiP) */}
        {localStream && hasVideo && !videoOff && (
          <div id="local-player" className="absolute bottom-4 right-4 w-28 h-20 rounded-xl overflow-hidden border-2"
            style={{ borderColor: "hsl(var(--primary) / 0.5)" }}>
            <video ref={localVideoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
          </div>
        )}
      </div>

      {/* Controls bar */}
      <div className="shrink-0 relative flex items-center justify-center gap-4 py-8"
        style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(12px)" }}>

        {devicePickerOpen && status === "active" && (
          <div
            data-testid="panel-call-devices"
            className="absolute bottom-full mb-3 w-[min(92vw,420px)] space-y-4 rounded-xl border border-border bg-card p-4 text-card-foreground shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <p className="font-bold">أجهزة المكالمة</p>
              <Button data-testid="button-refresh-devices" variant="ghost" size="sm" onClick={() => void onRefreshDevices()}>
                تحديث
              </Button>
            </div>
            {microphones.length > 1 && (
              <DeviceSelect label="الميكروفون" devices={microphones} value={selectedMicrophoneId} disabled={switchingDevice === "audioinput"} onChange={id => void onSwitchMicrophone(id)} />
            )}
            {cameras.length > 1 && hasVideo && (
              <DeviceSelect label="الكاميرا" devices={cameras} value={selectedCameraId} disabled={switchingDevice === "videoinput"} onChange={id => void onSwitchCamera(id)} />
            )}
            {speakerSelectionSupported ? (
              speakers.length > 1 && <DeviceSelect label="مكبر الصوت" devices={speakers} value={selectedSpeakerId} onChange={onSelectSpeaker} />
            ) : (
              <p data-testid="text-speaker-selection-unsupported" className="text-xs text-muted-foreground">
                اختيار مكبر الصوت غير مدعوم في هذا المتصفح المحمول. يمكنك تغيير المخرج من إعدادات الهاتف، بينما تبقى خيارات الميكروفون والكاميرا متاحة هنا.
              </p>
            )}
          </div>
        )}

        <button onClick={() => setMuted(v => !v)}
          aria-label={muted ? st.unmute : st.mute}
          className="w-13 h-13 w-12 h-12 rounded-full flex items-center justify-center transition-all active:scale-95"
          style={{ background: muted ? "hsl(var(--destructive))" : "hsl(var(--secondary))", border: "1px solid hsl(var(--border) / 0.5)" }}>
          {muted ? <MicOff className="w-5 h-5 text-white" /> : <Mic className="w-5 h-5 text-white" />}
        </button>

        {hasVideo && (
          <button onClick={() => setVideoOff(v => !v)}
            aria-label={videoOff ? st.enable_video : st.disable_video}
            className="w-12 h-12 rounded-full flex items-center justify-center transition-all active:scale-95"
            style={{ background: videoOff ? "hsl(var(--destructive))" : "hsl(var(--secondary))", border: "1px solid hsl(var(--border) / 0.5)" }}>
            {videoOff ? <VideoOff className="w-5 h-5 text-white" /> : <Video className="w-5 h-5 text-white" />}
          </button>
        )}

        {/* End call — center large */}
        <button onClick={onEnd}
          aria-label={st.end_call}
          className="w-16 h-16 rounded-full flex items-center justify-center transition-all active:scale-95 shadow-lg"
          style={{ background: "hsl(var(--destructive))" }}>
          <PhoneOff className="w-7 h-7 text-white" />
        </button>

        <button onClick={() => setSpeakerOff(v => !v)}
          aria-label={speakerOff ? st.enable_speaker : st.disable_speaker}
          className="w-12 h-12 rounded-full flex items-center justify-center transition-all active:scale-95"
          style={{ background: speakerOff ? "hsl(var(--destructive))" : "hsl(var(--secondary))", border: "1px solid hsl(var(--border) / 0.5)" }}>
          {speakerOff ? <VolumeX className="w-5 h-5 text-white" /> : <Volume2 className="w-5 h-5 text-white" />}
        </button>

        {status === "active" && (microphones.length > 1 || cameras.length > 1 || speakers.length > 1 || !speakerSelectionSupported) && (
          <button
            data-testid="button-call-devices"
            onClick={() => { setDevicePickerOpen(value => !value); void onRefreshDevices(); }}
            aria-label="اختيار أجهزة المكالمة"
            className="w-12 h-12 rounded-full flex items-center justify-center transition-all active:scale-95"
            style={{ background: devicePickerOpen ? "hsl(var(--primary))" : "hsl(var(--secondary))", border: "1px solid hsl(var(--border) / 0.5)" }}
          >
            <Settings2 className="w-5 h-5 text-white" />
          </button>
        )}

        {/* Screen share */}
        {status === "active" && onScreenShare && (
          <button
            onClick={screenSharing ? onStopScreen : onScreenShare}
            className="w-12 h-12 rounded-full flex items-center justify-center transition-all active:scale-95"
            style={{ background: screenSharing ? "#f59e0b" : "hsl(var(--secondary))", border: "1px solid hsl(var(--border) / 0.5)" }}
            title={screenSharing ? st.stop_sharing : st.share_screen}
            aria-label={screenSharing ? st.stop_sharing : st.share_screen}>
            {screenSharing
              ? <MonitorOff className="w-5 h-5 text-black" />
              : <Monitor className="w-5 h-5 text-white" />}
          </button>
        )}

        <button onClick={() => setMinimized(true)}
          aria-label={st.minimize}
          className="w-12 h-12 rounded-full flex items-center justify-center transition-all active:scale-95"
          style={{ background: "hsl(var(--secondary))", border: "1px solid hsl(var(--border) / 0.5)" }}>
          <Minimize2 className="w-5 h-5 text-white" />
        </button>
      </div>
    </motion.div>
  );
}

function DeviceSelect({
  label, devices, value, disabled = false, onChange,
}: {
  label: string;
  devices: CallDevice[];
  value: string;
  disabled?: boolean;
  onChange: (deviceId: string) => void;
}) {
  const fallbackValue = value || devices[0]?.deviceId;
  if (!fallbackValue) return null;
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Select value={fallbackValue} disabled={disabled} onValueChange={onChange}>
        <SelectTrigger data-testid={`select-${devices[0].kind}`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {devices.map(device => (
            <SelectItem key={device.deviceId} value={device.deviceId}>
              {device.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
