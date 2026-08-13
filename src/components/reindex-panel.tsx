import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getIndexV2Stats, nextReindexBatch, saveVectorsV2 } from "@/lib/vector.functions";
import {
  callWithAuthRefresh,
  classifyError,
  logReindex,
  retryWithBackoff,
  settle,
  withTimeout,
  type ReindexErrorKind,
} from "@/lib/reindex-reliability";
import { Cpu, Loader2, Play, Square } from "lucide-react";
import { toast } from "sonner";

/**
 * Reindexação do catálogo com o motor visual que roda no próprio navegador.
 * Não consome créditos: as fotos são baixadas por link temporário e o vetor
 * é calculado localmente.
 */
const BATCH = 50;
const RPC_TIMEOUT_MS = 90_000;
const IMAGE_TIMEOUT_MS = 60_000;
const MAX_ATTEMPTS_PER_PIECE = 3;
const MAX_FILTERED_BATCHES = 3;

type ErrorCounts = Record<ReindexErrorKind, number>;

const EMPTY_COUNTS: ErrorCounts = {
  timeout: 0,
  network: 0,
  auth: 0,
  image: 0,
  model: 0,
  rpc: 0,
  unknown: 0,
};

type BatchItem = { id: string; code: string; url: string };

export function ReindexPanel() {
  const qc = useQueryClient();
  const statsFn = useServerFn(getIndexV2Stats);
  const batchFn = useServerFn(nextReindexBatch);
  const saveFn = useServerFn(saveVectorsV2);

  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<string>("");
  const [errors, setErrors] = useState(0);
  const [errorCounts, setErrorCounts] = useState<ErrorCounts>(EMPTY_COUNTS);
  const [sessionStats, setSessionStats] = useState({ processed: 0, saved: 0 });
  const stopRef = useRef(false);
  const loopActiveRef = useRef(false);
  const attemptsRef = useRef<Map<string, { code: string; attempts: number }>>(new Map());
  const failedThisSessionRef = useRef<Set<string>>(new Set());
  const consecutiveFilteredRef = useRef(0);

  const { data: stats } = useQuery({
    queryKey: ["index-v2-stats"],
    queryFn: () => statsFn(),
    staleTime: 5_000,
  });

  useEffect(() => {
    return () => {
      stopRef.current = true;
    };
  }, []);

  async function fetchBatch() {
    return retryWithBackoff(
      () =>
        callWithAuthRefresh({
          label: "nextReindexBatch",
          run: () =>
            withTimeout(
              (signal) => batchFn({ data: { size: BATCH }, signal }),
              RPC_TIMEOUT_MS,
              "nextReindexBatch",
            ),
        }),
      { attempts: 3, baseMs: 1000, label: "nextReindexBatch" },
    );
  }

  async function saveBatch(payload: Array<{ id: string; vector: number[] }>) {
    return retryWithBackoff(
      () =>
        callWithAuthRefresh({
          label: "save_vectors_v2",
          run: () =>
            withTimeout(
              (signal) => saveFn({ data: { items: payload }, signal }),
              RPC_TIMEOUT_MS,
              "save_vectors_v2",
            ),
        }),
      { attempts: 3, baseMs: 1000, label: "save_vectors_v2" },
    );
  }

  async function safeRefetchStats() {
    try {
      const s = await withTimeout(
        (signal) => statsFn({ signal }),
        RPC_TIMEOUT_MS,
        "index_v2_stats",
      );
      qc.setQueryData(["index-v2-stats"], s);
    } catch (err) {
      logReindex("warn", "stats-falhou", { mensagem: classifyError(err).message });
    }
  }

  function registerPieceFailure(id: string, code: string, kind: ReindexErrorKind, message: string) {
    const current = attemptsRef.current.get(id)?.attempts ?? 0;
    const nextAttempts = current + 1;
    attemptsRef.current.set(id, { code, attempts: nextAttempts });
    const definitive = nextAttempts >= MAX_ATTEMPTS_PER_PIECE;
    if (definitive) failedThisSessionRef.current.add(id);
    setErrors((e) => e + 1);
    setErrorCounts((prev) => ({ ...prev, [kind]: prev[kind] + 1 }));
    logReindex(
      definitive ? "warn" : "info",
      definitive ? "peça-falhou-na-sessão" : "peça-com-erro",
      { codigo: code, id, tipo: kind, mensagem: message, tentativas: nextAttempts },
    );
  }

  async function start() {
    if (loopActiveRef.current) {
      toast.info("Reindexação já está em andamento nesta aba.");
      return;
    }
    loopActiveRef.current = true;
    stopRef.current = false;
    setRunning(true);
    setErrors(0);
    setErrorCounts({ ...EMPTY_COUNTS });
    setSessionStats({ processed: 0, saved: 0 });
    attemptsRef.current = new Map();
    failedThisSessionRef.current = new Set();
    consecutiveFilteredRef.current = 0;
    setStatus("Carregando o modelo visual (só na primeira vez)...");
    try {
      const { embedImageSource, loadDino } = await import("@/lib/dino-engine");
      await loadDino();
      setStatus("Reindexando...");

      let batchIndex = 0;
      let pending = settle(fetchBatch());

      while (!stopRef.current) {
        const batchStart = Date.now();
        const res = await pending;
        if (!res.ok) throw res.value;
        const { items } = res.value as { items: BatchItem[] };
        if (items.length === 0) {
          setStatus("Reindexação concluída.");
          toast.success("Catálogo totalmente reindexado.");
          break;
        }
        pending = settle(fetchBatch());
        batchIndex++;
        logReindex("info", "lote-iniciado", { lote: batchIndex, tamanho: items.length });

        const usable = items.filter((item) => !failedThisSessionRef.current.has(item.id));
        const filteredOut = items.length - usable.length;

        if (usable.length === 0) {
          consecutiveFilteredRef.current++;
          logReindex("warn", "lote-filtrado", {
            lote: batchIndex,
            filtradas: filteredOut,
            consecutivos: consecutiveFilteredRef.current,
          });
          if (consecutiveFilteredRef.current >= MAX_FILTERED_BATCHES) {
            const n = failedThisSessionRef.current.size;
            setStatus(
              `Sessão encerrada — os últimos lotes continham apenas peças já falhadas nesta sessão (${n}). Reinicie a reindexação para tentá-las novamente.`,
            );
            toast.info(
              `${n} peça(s) com falha nesta sessão foram puladas. As demais estão indexadas.`,
            );
            break;
          }
          continue;
        }
        consecutiveFilteredRef.current = 0;

        const payload: Array<{ id: string; vector: number[] }> = [];
        let batchErrors = 0;
        let processed = 0;
        const errorKinds: Record<string, number> = {};

        for (const item of usable) {
          if (stopRef.current) break;
          const priorAttempts = attemptsRef.current.get(item.id)?.attempts ?? 0;
          if (priorAttempts >= MAX_ATTEMPTS_PER_PIECE) {
            failedThisSessionRef.current.add(item.id);
            continue;
          }
          try {
            const vector = await retryWithBackoff(
              () => embedImageSource(item.url, { timeoutMs: IMAGE_TIMEOUT_MS }),
              { attempts: 3, baseMs: 1000, label: `embed:${item.code}` },
            );
            payload.push({ id: item.id, vector });
            processed++;
          } catch (err) {
            const r = classifyError(err);
            batchErrors++;
            errorKinds[r.kind] = (errorKinds[r.kind] ?? 0) + 1;
            registerPieceFailure(item.id, item.code, r.kind, r.message);
          }
        }

        if (stopRef.current) break;

        if (payload.length > 0) {
          try {
            const { saved } = await saveBatch(payload);
            setSessionStats((s) => ({
              processed: s.processed + processed,
              saved: s.saved + saved,
            }));
            setStatus(`Reindexando... ${saved} salva(s) nesta sessão`);
            logReindex("info", "lote-salvo", { lote: batchIndex, salvas: saved });
            await safeRefetchStats();
          } catch (err) {
            const r = classifyError(err);
            logReindex("error", "lote-falhou", {
              lote: batchIndex,
              tipo: r.kind,
              mensagem: r.message,
            });
            setStatus(
              `Falha ao salvar o lote ${batchIndex} (${r.message}) — reindexação interrompida de forma controlada. Os vetores já gravados foram preservados; use Continuar para retomar.`,
            );
            toast.error(
              "Falha ao salvar o lote — reindexação interrompida. Use Continuar para retomar.",
            );
            break;
          }
        } else {
          logReindex("error", "lote-falho-completo", {
            lote: batchIndex,
            erros: batchErrors,
            tipos: errorKinds,
            filtradas: filteredOut,
          });
          setStatus(
            `Lote ${batchIndex} falhou por completo (${batchErrors} erro(s)) — as peças ficaram pendentes e serão tentadas novamente em uma próxima sessão.`,
          );
          toast.error("Lote falhou por completo — nada foi salvo deste lote.");
        }

        logReindex("info", "lote-concluído", {
          lote: batchIndex,
          tamanho: items.length,
          processadas: processed,
          salvas: payload.length,
          erros: batchErrors,
          duracaoMs: Date.now() - batchStart,
          filtradas: filteredOut,
          tiposDeErro: errorKinds,
        });
      }
    } catch (err) {
      const r = classifyError(err);
      if (r.kind === "auth") {
        setStatus(
          "Sessão expirada e não foi possível renová-la — a reindexação foi interrompida. Entre novamente e clique em Continuar.",
        );
        toast.error("Sessão expirada — entre novamente para continuar a reindexação.");
      } else {
        setStatus(`Reindexação interrompida (${r.message}). Use Continuar para retomar.`);
        toast.error(`Reindexação interrompida: ${r.message}`);
      }
      logReindex("error", "sessao-interrompida", { tipo: r.kind, mensagem: r.message });
    } finally {
      loopActiveRef.current = false;
      setRunning(false);
      await safeRefetchStats();
    }
  }

  const total = stats?.total ?? 0;
  const indexed = stats?.indexed ?? 0;
  const pending = Math.max(0, total - indexed);
  const pct = total > 0 ? Math.round((indexed / total) * 100) : 0;

  return (
    <section className="mb-8 rounded-xl border border-border bg-card/60 backdrop-blur p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Cpu className="h-5 w-5 text-[color:var(--gold)]" />
          <h2 className="serif text-xl gold-text">Motor visual local (sem créditos)</h2>
        </div>
        <div className="flex items-center gap-2">
          {running ? (
            <button
              onClick={() => {
                stopRef.current = true;
                setStatus(
                  "Parando — finaliza o lote atual, preserva vetores já gravados e permite Continuar depois.",
                );
              }}
              className="inline-flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm"
            >
              <Square className="h-4 w-4" /> Parar
            </button>
          ) : (
            <button
              onClick={start}
              disabled={indexed >= total && total > 0}
              className="inline-flex items-center gap-2 rounded-md gold-gradient px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              <Play className="h-4 w-4" />
              {indexed > 0 && indexed < total ? "Continuar reindexação" : "Iniciar reindexação"}
            </button>
          )}
        </div>
      </div>

      <p className="mt-2 text-sm text-muted-foreground">
        A busca por imagem agora é calculada no seu navegador, de graça. Para funcionar em todo o
        catálogo, as peças precisam ser reindexadas uma única vez. Mantenha esta aba aberta durante
        o processo — ele pode ser pausado e continuado depois de onde parou.
      </p>

      <div className="mt-4 space-y-1.5">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            Indexadas no banco: {indexed.toLocaleString("pt-BR")} de {total.toLocaleString("pt-BR")}{" "}
            · pendentes: {pending.toLocaleString("pt-BR")}
          </span>
          <span>{pct}%</span>
        </div>
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            Esta sessão: {sessionStats.processed} processada(s) · {sessionStats.saved} salva(s) ·{" "}
            {errors} erro(s)
          </span>
          <span className="text-right">
            timeout {errorCounts.timeout} · rede {errorCounts.network} · auth {errorCounts.auth} ·
            imagem {errorCounts.image} · modelo {errorCounts.model}
          </span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
          <div className="h-full gold-gradient transition-all" style={{ width: `${pct}%` }} />
        </div>
      </div>

      {(running || status) && (
        <div className="mt-3 flex items-center gap-2 text-sm">
          {running && <Loader2 className="h-4 w-4 animate-spin text-[color:var(--gold)]" />}
          <span className="text-muted-foreground">{status}</span>
          {errors > 0 && <span className="text-destructive">{errors} falha(s)</span>}
        </div>
      )}
    </section>
  );
}
