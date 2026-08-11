import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { getIndexV2Stats, nextReindexBatch, saveVectorsV2 } from "@/lib/vector.functions";
import { Cpu, Loader2, Play, Square } from "lucide-react";
import { toast } from "sonner";

/**
 * Reindexação do catálogo com o motor visual que roda no próprio navegador.
 * Não consome créditos: as fotos são baixadas por link temporário e o vetor
 * é calculado localmente.
 */
export function ReindexPanel() {
  const statsFn = useServerFn(getIndexV2Stats);
  const batchFn = useServerFn(nextReindexBatch);
  const saveFn = useServerFn(saveVectorsV2);

  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<string>("");
  const [errors, setErrors] = useState(0);
  const stopRef = useRef(false);

  const { data: stats, refetch } = useQuery({
    queryKey: ["index-v2-stats"],
    queryFn: () => statsFn(),
    staleTime: 5_000,
  });

  useEffect(() => {
    return () => {
      stopRef.current = true;
    };
  }, []);

  async function start() {
    stopRef.current = false;
    setRunning(true);
    setErrors(0);
    setStatus("Carregando o modelo visual (só na primeira vez)...");
    try {
      const { embedImageSource, loadDino } = await import("@/lib/dino.client");
      await loadDino();
      setStatus("Reindexando...");
      let processed = 0;

      while (!stopRef.current) {
        const { items } = await batchFn({ data: { size: 20 } });
        if (items.length === 0) {
          setStatus("Reindexação concluída.");
          toast.success("Catálogo totalmente reindexado.");
          break;
        }
        const payload: Array<{ id: string; vector: number[] }> = [];
        for (const item of items) {
          if (stopRef.current) break;
          try {
            const vector = await embedImageSource(item.url);
            payload.push({ id: item.id, vector });
          } catch {
            setErrors((e) => e + 1);
          }
        }
        if (payload.length > 0) {
          await saveFn({ data: { items: payload } });
          processed += payload.length;
          setStatus(`Reindexando... ${processed} peça(s) nesta sessão`);
          refetch();
        } else if (!stopRef.current) {
          throw new Error("Nenhuma foto do lote pôde ser processada.");
        }
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha na reindexação");
    } finally {
      setRunning(false);
      refetch();
    }
  }

  const total = stats?.total ?? 0;
  const indexed = stats?.indexed ?? 0;
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
                setStatus("Parando...");
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
        catálogo, as peças precisam ser reindexadas uma única vez. Mantenha esta aba aberta durante o
        processo — ele pode ser pausado e continuado depois de onde parou.
      </p>

      <div className="mt-4">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {indexed.toLocaleString("pt-BR")} de {total.toLocaleString("pt-BR")} peça(s)
          </span>
          <span>{pct}%</span>
        </div>
        <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-muted">
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
