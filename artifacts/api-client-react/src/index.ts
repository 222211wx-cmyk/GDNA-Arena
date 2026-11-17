// Placeholder: original @workspace/api-client-react is missing from the repository.
import type { UseMutationResult, UseQueryResult } from "@tanstack/react-query";

const notImplemented = (name: string) => (): never => {
  throw new Error(`[stub] ${name} is not implemented`);
};
const stubQuery = <T,>(_name: string) => (..._args: any[]): UseQueryResult<T, Error> => ({ data: undefined, isLoading: false, isFetching: false, isError: false, isPending: false, error: null, refetch: async () => undefined } as unknown as UseQueryResult<T, Error>);
const stubMutation = <TData, TVars>(_name: string) => (..._args: any[]): UseMutationResult<TData, Error, TVars> => ({ mutate: () => undefined, mutateAsync: async () => undefined, isPending: false, error: null } as unknown as UseMutationResult<TData, Error, TVars>);

export interface ExhaustedClipThumbnail { id: number; [key: string]: any }
export interface ExhaustedClipThumbnailsPage { clips: ExhaustedClipThumbnail[]; [key: string]: any }
export type OfflineRecoveryResult = any;
export type OfflineRecoveryStatus = any;

export const useGetGsDomains = stubQuery<{ domains?: any[]; [key: string]: any }>("useGetGsDomains");
export const useGetGsRanking = stubQuery<{ ranking?: any[]; [key: string]: any }>("useGetGsRanking");
export const useGetGsNews = stubQuery<{ articles?: any[]; [key: string]: any }>("useGetGsNews");
export const useGetGsFigures = stubQuery<{ figures?: any[]; [key: string]: any }>("useGetGsFigures");
export const useGetGsTraditions = stubQuery<{ traditions?: any[]; [key: string]: any }>("useGetGsTraditions");
export const useGetExhaustedClipThumbnails = stubQuery<ExhaustedClipThumbnailsPage>("useGetExhaustedClipThumbnails");
export const useRequeueClipThumbnail = stubMutation<any, any>("useRequeueClipThumbnail");
export const useSendArenaWithdrawRequest = stubMutation<{ content: string }, any>("useSendArenaWithdrawRequest");
export const useGetRecoveryCodeStatus = stubQuery<any>("useGetRecoveryCodeStatus");
export const getGetExhaustedClipThumbnailsQueryKey = (params?: unknown): readonly unknown[] => ["/api/privileged/clips/thumbnails/exhausted", params];
export const getGetRecoveryCodeStatusQueryKey = (): readonly unknown[] => ["/api/recovery-code/status"];
export const generateRecoveryCode = async (..._args: any[]): Promise<any> => notImplemented("generateRecoveryCode")();
export const redeemRecoveryCode = async (..._args: any[]): Promise<any> => notImplemented("redeemRecoveryCode")();
export const removeRecoveryCode = async (..._args: any[]): Promise<any> => notImplemented("removeRecoveryCode")();
export const listMessagingSubscriptions = async (): Promise<Array<{ id: number; username: string; [key: string]: any }>> => notImplemented("listMessagingSubscriptions")();
export const updateMessagingSubscription = async (_id: number, _body: Record<string, unknown>): Promise<any> => notImplemented("updateMessagingSubscription")();
