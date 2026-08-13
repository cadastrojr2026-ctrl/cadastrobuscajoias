import { supabase } from "@/integrations/supabase/client";

export type ReindexErrorKind =
  "timeout" | "network" | "auth" | "image" | "model" | "rpc" | "unknown";

export class ReindexError extends Error {
  readonly kind: ReindexErrorKind;
  readonly isTransient: boolean;
  readonly cause?: unknown;

  constructor(kind: ReindexErrorKind, message: string, cause?: unknown) {
    super(message);
    this.name = "ReindexError";
    this.kind = kind;
    this.cause = cause;
    this.isTransient = kind === "timeout" || kind === "network";
  }
}

export function classifyError(err: unknown): ReindexError {
  if (err instanceof ReindexError) return err;
  const msg = err instanceof Error ? err.message : String(err ?? "erro desconhecido");
  const name = err instanceof Error ? err.name : "";
  const status = (err as { statusCode?: number } | null)?.statusCode;
  if (name === "AbortError" || name === "TimeoutError" || /timeout|timed out|abort/i.test(msg)) {
    return new ReindexError("timeout", msg, err);
  }
  if (
    status === 401 ||
    /unauthorized|invalid token|no token|no authorization|bearer token/i.test(msg)
  ) {
    return new ReindexError("auth", msg, err);
  }
  if (
    /fetch failed|networkerror|network_error|failed to fetch|load failed|err_|cors|network/i.test(
      msg,
    )
  ) {
    return new ReindexError("network", msg, err);
  }
  return new ReindexError("unknown", msg, err);
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function withTimeout<T>(
  task: (signal: AbortSignal) => Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  const controller = new AbortController();
  const { signal } = controller;
  let timedOut = false;
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(new ReindexError("timeout", `Timeout de ${ms}ms em ${label}`));
    }, ms);
  });
  const run = task(signal).catch((err: unknown) => {
    if (timedOut || (signal.aborted && (err as { name?: string } | null)?.name === "AbortError")) {
      throw new ReindexError("timeout", `Timeout de ${ms}ms em ${label}`, err);
    }
    throw err;
  });
  return Promise.race([run, timeoutPromise]);
}

export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  opts: {
    attempts?: number;
    baseMs?: number;
    label?: string;
    onRetry?: (attempt: number, err: ReindexError) => void;
  } = {},
): Promise<T> {
  const attempts = Math.max(1, opts.attempts ?? 3);
  const baseMs = opts.baseMs ?? 500;
  let last: ReindexError | undefined;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const r = classifyError(err);
      last = r;
      if (!r.isTransient || attempt >= attempts) throw r;
      opts.onRetry?.(attempt, r);
      await sleep(baseMs * 2 ** (attempt - 1) + Math.random() * 200);
    }
  }
  throw last ?? new ReindexError("unknown", `Falha em ${opts.label ?? "operação"}`);
}

export async function callWithAuthRefresh<T>(opts: {
  run: () => Promise<T>;
  label: string;
}): Promise<T> {
  try {
    return await opts.run();
  } catch (err) {
    const r = classifyError(err);
    if (r.kind !== "auth") throw r;
    logReindex("warn", "auth-refresh", { label: opts.label, motivo: r.message });
    const { data, error } = await supabase.auth.refreshSession();
    if (error || !data.session) {
      throw new ReindexError(
        "auth",
        `Sessão expirada e não foi possível renová-la automaticamente (${opts.label}). Entre novamente para continuar.`,
        error ?? r,
      );
    }
    try {
      return await opts.run();
    } catch (err2) {
      const r2 = classifyError(err2);
      if (r2.kind === "auth") {
        throw new ReindexError(
          "auth",
          `Sessão inválida mesmo após renovação (${opts.label}). Entre novamente para continuar.`,
          err2,
        );
      }
      throw r2;
    }
  }
}

export type Settled<T> = { ok: true; value: T } | { ok: false; value: unknown };

export function settle<T>(promise: Promise<T>): Promise<Settled<T>> {
  return promise.then(
    (value) => ({ ok: true as const, value }),
    (value) => ({ ok: false as const, value }),
  );
}

type LogLevel = "info" | "warn" | "error";

export function logReindex(
  level: LogLevel,
  event: string,
  fields: Record<string, unknown> = {},
): void {
  const entry = { ts: new Date().toISOString(), event, ...fields };
  if (level === "warn") console.warn("[reindex]", entry);
  else if (level === "error") console.error("[reindex]", entry);
  else console.info("[reindex]", entry);
}
