// Placeholder: original module is missing from the repository. Replace with the real implementation.
import { stub, type StubFn } from "../../lib/_stub";

export const CHUNK_BYTES: any = stub("CHUNK_BYTES");
export const MAX_TRANSFER_BYTES: any = stub("MAX_TRANSFER_BYTES");
export interface PeerTransferItem {
  id: string;
  [key: string]: any;
}
export type TransferKind = any;
export const createChunkFrame: StubFn = stub("createChunkFrame");
export const parseChunkFrame: StubFn = stub("parseChunkFrame");
export const peerTransfer = {
  attach: (_pc: RTCPeerConnection, _options?: { createChannel?: boolean }): (() => void) => () => {},
  detach: (): void => {},
  getSnapshot: (): { transfers: PeerTransferItem[]; [key: string]: any } => ({ transfers: [] }),
  subscribe: (_listener: () => void): (() => void) => () => {},
  sendFile: async (..._args: any[]): Promise<any> => undefined,
  accept: (..._args: any[]): any => undefined,
  reject: (..._args: any[]): any => undefined,
  download: (..._args: any[]): any => undefined,
  cancel: (..._args: any[]): any => undefined,
};
export const validateTransferMetadata: StubFn = stub("validateTransferMetadata");
