import type OpenAI from "openai";

/**
 * This is deliberately a user-facing, non-provider-specific message. Callers
 * can use it when an AI feature is unavailable without exposing provider
 * configuration or billing details.
 */
export const AI_UNAVAILABLE_MESSAGE =
  "AI features are temporarily unavailable. Please try again later.";

export type OpenAIErrorCode =
  | "AI_UNAVAILABLE"
  | "AI_QUOTA_EXHAUSTED"
  | "AI_UNAUTHORIZED"
  | "AI_RATE_LIMITED"
  | "AI_TIMEOUT"
  | "AI_PROVIDER_ERROR";

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_RETRIES = 0;
const DEFAULT_COOLDOWN_MS = 5 * 60_000;

export interface OpenAIClientFactoryOptions {
  apiKey: string;
  timeout: number;
  maxRetries: number;
}

/**
 * A factory is injectable so jobs and tests can use a provider-compatible
 * client without constructing the SDK at module import time.
 */
export type OpenAIClientFactory = (
  options: OpenAIClientFactoryOptions,
) => OpenAI | PromiseLike<OpenAI>;

export interface OptionalOpenAIOptions {
  /** Defaults to OPENAI_API_KEY, read when a request is made. */
  apiKey?: string;
  /** Passed to the SDK and applied to each request/stream read. */
  timeoutMs?: number;
  /** Passed to the SDK. The value is clamped to keep retries bounded. */
  maxRetries?: number;
  /** Shared circuit-open duration after quota or authentication failures. */
  cooldownMs?: number;
  /** Dependency injection for the SDK (also useful for focused tests). */
  clientFactory?: OpenAIClientFactory;
  /** Alias retained for consumers that prefer the verb used by the SDK. */
  createClient?: OpenAIClientFactory;
  /** Clock injection for deterministic circuit-breaker tests. */
  now?: () => number;
}

export class OptionalOpenAIError extends Error {
  readonly code: OpenAIErrorCode;
  readonly status: number;

  constructor(code: OpenAIErrorCode, status = 502) {
    super(errorMessage(code));
    this.name = "OpenAIClientError";
    this.code = code;
    this.status = status;
  }
}

interface CircuitState {
  keyFingerprint: string;
  openUntil: number;
  code: "AI_QUOTA_EXHAUSTED" | "AI_UNAUTHORIZED";
}

let quotaCircuit: CircuitState | undefined;

function errorMessage(code: OpenAIErrorCode): string {
  switch (code) {
    case "AI_UNAVAILABLE":
      return AI_UNAVAILABLE_MESSAGE;
    case "AI_QUOTA_EXHAUSTED":
      return AI_UNAVAILABLE_MESSAGE;
    case "AI_UNAUTHORIZED":
      return AI_UNAVAILABLE_MESSAGE;
    case "AI_RATE_LIMITED":
      return "The AI service is busy. Please try again later.";
    case "AI_TIMEOUT":
      return "The AI service took too long to respond. Please try again.";
    default:
      return "The AI service could not complete this request.";
  }
}

function configuredKey(explicitKey?: string): string | undefined {
  const key = explicitKey ?? process.env.OPENAI_API_KEY;
  return key?.trim() || undefined;
}

/*
 * Keep the circuit's identity opaque. In particular, do not retain a key
 * prefix/suffix in state or include provider values in errors.
 */
function keyFingerprint(key: string): string {
  let hash = 2166136261;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function circuitIsOpen(key: string, now: number): boolean {
  if (!quotaCircuit) return false;
  const fingerprint = keyFingerprint(key);
  if (quotaCircuit.keyFingerprint !== fingerprint) {
    quotaCircuit = undefined;
    return false;
  }
  if (quotaCircuit.openUntil <= now) {
    quotaCircuit = undefined;
    return false;
  }
  return true;
}

function openCircuitWithCode(
  key: string,
  now: number,
  cooldownMs: number,
  code: "AI_QUOTA_EXHAUSTED" | "AI_UNAUTHORIZED",
): void {
  quotaCircuit = {
    keyFingerprint: keyFingerprint(key),
    openUntil: now + cooldownMs,
    code,
  };
}

function openCircuitError(
  key: string,
  now: number,
): OptionalOpenAIError | undefined {
  if (!circuitIsOpen(key, now) || !quotaCircuit) return undefined;
  return new OptionalOpenAIError(quotaCircuit.code, 503);
}

function normalizeTimeout(value: number | undefined): number {
  if (!Number.isFinite(value)) return DEFAULT_TIMEOUT_MS;
  return Math.min(Math.max(Math.floor(value as number), 1), 120_000);
}

function normalizeRetries(value: number | undefined): number {
  if (!Number.isFinite(value)) return DEFAULT_MAX_RETRIES;
  return Math.min(Math.max(Math.floor(value as number), 0), 5);
}

function normalizeCooldown(value: number | undefined): number {
  if (!Number.isFinite(value)) return DEFAULT_COOLDOWN_MS;
  return Math.min(Math.max(Math.floor(value as number), 1), 60 * 60_000);
}

function providerStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const candidate = error as {
    status?: unknown;
    response?: { status?: unknown };
  };
  if (typeof candidate.status === "number" && Number.isFinite(candidate.status)) {
    return candidate.status;
  }
  if (
    typeof candidate.response?.status === "number" &&
    Number.isFinite(candidate.response.status)
  ) {
    return candidate.response.status;
  }
  return undefined;
}

function providerText(error: unknown): string {
  if (!error || typeof error !== "object") return "";
  const candidate = error as {
    code?: unknown;
    type?: unknown;
    message?: unknown;
    error?: { code?: unknown; type?: unknown; message?: unknown };
  };
  return [
    candidate.code,
    candidate.type,
    candidate.message,
    candidate.error?.code,
    candidate.error?.type,
    candidate.error?.message,
  ]
    .filter((part): part is string => typeof part === "string")
    .join(" ")
    .toLowerCase();
}

function isQuotaFailure(error: unknown, status: number | undefined): boolean {
  const text = providerText(error);
  return (
    text.includes("insufficient_quota") ||
    text.includes("credit_balance_exhausted") ||
    text.includes("credit balance exhausted") ||
    (status === 429 && text.includes("quota"))
  );
}

function isTimeoutFailure(error: unknown): boolean {
  const text = providerText(error);
  return (
    text.includes("timeout") ||
    text.includes("timed out") ||
    text.includes("etimedout") ||
    text.includes("aborterror")
  );
}

function sanitizeProviderError(error: unknown): OptionalOpenAIError {
  if (error instanceof OptionalOpenAIError) return error;
  const status = providerStatus(error);
  if (isTimeoutFailure(error)) return new OptionalOpenAIError("AI_TIMEOUT", 504);
  if (status === 401) return new OptionalOpenAIError("AI_UNAUTHORIZED", 401);
  if (isQuotaFailure(error, status)) {
    return new OptionalOpenAIError("AI_QUOTA_EXHAUSTED", status ?? 429);
  }
  if (status === 429) return new OptionalOpenAIError("AI_RATE_LIMITED", 429);
  return new OptionalOpenAIError("AI_PROVIDER_ERROR", status ?? 502);
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] ===
      "function"
  );
}

function withTimeout<T>(
  promise: PromiseLike<T>,
  timeoutMs: number,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new OptionalOpenAIError("AI_TIMEOUT", 504));
    }, timeoutMs);

    Promise.resolve(promise).then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function* sanitizeStream(
  source: AsyncIterable<unknown>,
  timeoutMs: number,
  onProviderError: (error: OptionalOpenAIError) => void,
): AsyncIterable<unknown> {
  let iterator: AsyncIterator<unknown> | undefined;
  let completed = false;
  try {
    iterator = source[Symbol.asyncIterator]();
    while (true) {
      const next = await withTimeout(iterator.next(), timeoutMs);
      if (next.done) {
        completed = true;
        return;
      }
      yield next.value;
    }
  } catch (error) {
    const sanitized = sanitizeProviderError(error);
    onProviderError(sanitized);
    throw sanitized;
  } finally {
    if (!completed && iterator && typeof iterator.return === "function") {
      try {
        await withTimeout(iterator.return(), timeoutMs);
      } catch {
        // The original stream failure is the only error callers should see.
      }
    }
  }
}

async function defaultClientFactory(
  options: OpenAIClientFactoryOptions,
): Promise<OpenAI> {
  const module = await import("openai");
  return new module.default({
    apiKey: options.apiKey,
    timeout: options.timeout,
    maxRetries: options.maxRetries,
  });
}

export function isOpenAIAvailable(): boolean {
  const key = configuredKey();
  if (!key) return false;
  return !circuitIsOpen(key, Date.now());
}

/**
 * Return an OpenAI-shaped client without constructing the SDK until its first
 * provider call. Missing configuration therefore cannot crash process startup.
 */
export function createOptionalOpenAI(
  options: OptionalOpenAIOptions = {},
): OpenAI {
  const timeoutMs = normalizeTimeout(options.timeoutMs);
  const maxRetries = normalizeRetries(options.maxRetries);
  const cooldownMs = normalizeCooldown(options.cooldownMs);
  const now = options.now ?? Date.now;
  const factory = options.clientFactory ?? options.createClient ?? defaultClientFactory;

  let clientPromise: Promise<OpenAI> | undefined;
  let clientFingerprint: string | undefined;

  async function getClient(key: string): Promise<OpenAI> {
    const fingerprint = keyFingerprint(key);
    if (clientFingerprint !== fingerprint) {
      clientFingerprint = fingerprint;
      clientPromise = undefined;
    }
    if (!clientPromise) {
      clientPromise = Promise.resolve(
        factory({ apiKey: key, timeout: timeoutMs, maxRetries }),
      ).catch((error: unknown) => {
        clientPromise = undefined;
        throw sanitizeProviderError(error);
      });
    }
    return withTimeout(clientPromise, timeoutMs);
  }

  async function callProvider(
    operation: (client: OpenAI) => PromiseLike<unknown>,
  ): Promise<unknown> {
    const key = configuredKey(options.apiKey);
    if (!key) throw new OptionalOpenAIError("AI_UNAVAILABLE", 503);
    const existingCircuitError = openCircuitError(key, now());
    if (existingCircuitError) throw existingCircuitError;

    const registerCircuitFailure = (error: OptionalOpenAIError): void => {
      if (
        error.code === "AI_QUOTA_EXHAUSTED" ||
        error.code === "AI_UNAUTHORIZED"
      ) {
        openCircuitWithCode(key, now(), cooldownMs, error.code);
      }
    };

    try {
      const result = await withTimeout(
        operation(await getClient(key)),
        timeoutMs,
      );
      if (isAsyncIterable(result)) {
        return sanitizeStream(result, timeoutMs, registerCircuitFailure);
      }
      return result;
    } catch (error) {
      const sanitized = sanitizeProviderError(error);
      registerCircuitFailure(sanitized);
      throw sanitized;
    }
  }

  const facade = {
    chat: {
      completions: {
        create: (parameters: unknown, requestOptions?: unknown) =>
          callProvider((client) =>
            (client.chat.completions.create as (
              input: unknown,
              options?: unknown,
            ) => PromiseLike<unknown>)(
              parameters,
              requestOptions,
            ),
          ),
      },
    },
    embeddings: {
      create: (parameters: unknown, requestOptions?: unknown) =>
        callProvider((client) =>
          (client.embeddings.create as (
            input: unknown,
            options?: unknown,
          ) => PromiseLike<unknown>)(
            parameters,
            requestOptions,
          ),
        ),
    },
    moderations: {
      create: (parameters: unknown, requestOptions?: unknown) =>
        callProvider((client) =>
          (client.moderations.create as (
            input: unknown,
            options?: unknown,
          ) => PromiseLike<unknown>)(
            parameters,
            requestOptions,
          ),
        ),
    },
  };

  return facade as unknown as OpenAI;
}

/**
 * Intended for isolated tests. Production callers should wait for the finite
 * cooldown or change the configured key, both of which recover automatically.
 */
export function resetOpenAICircuitForTests(): void {
  quotaCircuit = undefined;
}
