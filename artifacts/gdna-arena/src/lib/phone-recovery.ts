// Placeholder: original module is missing from the repository. Replace with the real implementation.
import { stub, type StubFn } from "./_stub";

export type PhoneRecoverySession = any;
export type RecoveryConfig = any;
export type RecoveryPhone = any;
export const createPhoneRecoverySession: StubFn = stub("createPhoneRecoverySession");
export const recoveryErrorText: StubFn = stub("recoveryErrorText");
export const recoveryRequest = async <T = unknown>(_action: string, _body?: unknown, _signal?: AbortSignal): Promise<T> => stub("recoveryRequest")() as T;
