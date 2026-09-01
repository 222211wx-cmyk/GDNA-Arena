import { createContext, useContext, type ReactNode } from "react";
import { useCall } from "@/hooks/useCall";
import { useAuth } from "@/contexts/AuthContext";
import CallOverlay from "@/components/CallOverlay";

type CallCtx = ReturnType<typeof useCall>;
const CallContext = createContext<CallCtx | null>(null);

export function CallProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const call = useCall(user ?? null);

  return (
    <CallContext.Provider value={call}>
      {children}
      <CallOverlay
        status={call.callStatus}
        peer={call.activePeer}
        localStream={call.localStream}
        remoteStream={call.remoteStream}
        incomingCall={call.incomingCall}
        onAnswer={call.answerCall}
        onReject={call.rejectCall}
        onEnd={call.endCall}
        screenSharing={call.screenSharing}
        onScreenShare={call.screenShareSupported ? call.startScreenShare : undefined}
        onStopScreen={call.screenShareSupported ? call.stopScreenShare : undefined}
        callError={call.callError}
        devices={call.callDevices}
        selectedMicrophoneId={call.selectedMicrophoneId}
        selectedCameraId={call.selectedCameraId}
        selectedSpeakerId={call.selectedSpeakerId}
        speakerSelectionSupported={call.speakerSelectionSupported}
        deviceIssue={call.deviceIssue}
        switchingDevice={call.switchingDevice}
        onRefreshDevices={call.refreshCallDevices}
        onSwitchMicrophone={call.switchMicrophone}
        onSwitchCamera={call.switchCamera}
        onSelectSpeaker={call.selectSpeaker}
        onSpeakerFailure={call.reportSpeakerFailure}
        onSpeakerSuccess={call.reportSpeakerSuccess}
        onDeviceRecoveryAttempt={call.reportDeviceRecoveryAttempt}
      />
    </CallContext.Provider>
  );
}

export function useCallContext() {
  const ctx = useContext(CallContext);
  if (!ctx) throw new Error("useCallContext must be inside CallProvider");
  return ctx;
}
