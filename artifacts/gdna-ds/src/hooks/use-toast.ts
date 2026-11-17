export interface ToastOptions {
  title?: string;
  description?: string;
  variant?: string;
  [key: string]: unknown;
}
export function useToast() {
  return { toast: (_options: ToastOptions) => undefined, toasts: [] as ToastOptions[] };
}
