// Placeholder: original module is missing from the repository. Replace with the real implementation.
import type { ICameraVideoTrack, IRemoteVideoTrack, IRemoteAudioTrack } from "agora-rtc-sdk-ng";

export interface GroupParticipant {
  userId: number;
  username: string;
  status: string;
}

export interface GroupRemoteTrack {
  uid: string | number;
  videoTrack?: IRemoteVideoTrack;
  audioTrack?: IRemoteAudioTrack;
}

export interface GroupCallInfo {
  id?: number | string;
  participants: GroupParticipant[];
  [key: string]: any;
}

export function useGroupCall(_user: unknown, _directCallStatus?: unknown) {
  return {
    status: "idle" as string,
    error: null as string | null,
    busy: false,
    muted: false,
    cameraOff: false,
    screenSharing: false,
    localUserId: undefined as number | undefined,
    localStream: null as MediaStream | null,
    remoteStreams: [] as MediaStream[],
    localVideoTrack: null as ICameraVideoTrack | null,
    call: null as GroupCallInfo | null,
    incoming: null as GroupCallInfo | null,
    remoteTracks: [] as GroupRemoteTrack[],
    startCall: async (..._args: any[]): Promise<any> => undefined,
    answerCall: async (..._args: any[]): Promise<any> => undefined,
    rejectCall: async (..._args: any[]): Promise<any> => undefined,
    endCall: async (..._args: any[]): Promise<any> => undefined,
    toggleMute: (): void => {},
    toggleCamera: (): void => {},
    startScreenShare: async (): Promise<void> => {},
    stopScreenShare: async (): Promise<void> => {},
  };
}
