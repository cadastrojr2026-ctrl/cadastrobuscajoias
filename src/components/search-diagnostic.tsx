import { useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { diagnosePiece } from "@/lib/vector.functions";
import { Loader2, Stethoscope } from "lucide-react";
import { toast } from "sonner";

type Result = Awaited<ReturnType<typeof diagnosePiece>>;

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("Falha ao ler a imagem"));
    r.readAsDataURL(file);
  });
}

const pct = (n: number | null | undefined) => (n == null ? "—" : `${(n * 100).toFixed(1)}%`);

/** Explica por que uma peça não aparece na busca por foto. */
export function SearchDiagnostic() {
  const diagnoseFn = useServerFn(diagnosePiece);
  const [code, setCode] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function run() {
    if (!code.trim()) {
      toast.error("Informe o código da peça.");
      return;
    }
    setLoading(true);
    setResult(null);
    try {
      let vector: number[] | undefined;
      if (file) {
        const { embedImageSource } = await import("@/lib/dino-engine");
        vector = await embedImageSource(await fileToDataUrl(file));
      }
      setResult(await diagnoseFn({ data: { code: code.trim(), vector } }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro no diagnóstico");
    } finally {
      setLoading(false);
    }
  }

  const q = result && result.found ? result.query : null;

  return (
    <section className="mb-8 rounded-xl border border-border bg-card/60 backdrop-blur p-5">
      <div className="flex items-center gap-2">
        <Stethoscope className="h-5 w-5 text-[color:var(--gold)]" />
        <h2 className="serif text-xl gold-text">Diagnóstico da busca por foto</h2>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Informe o código de uma peça (e, se quiser, a foto que você usa na busca) para ver se ela
        tem vetor e em que posição ela aparece.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="Código, ex.: GAD02211"
          className="rounded-lg bg-background border border-[color:var(--gold)]/30 px-3 py-2 text-sm uppercase focus:outline-none focus:border-[color:var(--gold)]"
        />
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
        <button
          onClick={() => fileRef.current?.click()}
          className="rounded-lg border border-[color:var(--gold)]/40 px-4 py-2 text-xs font-medium hover:bg-[color:var(--gold)]/10"
        >
          {file ? `Foto: ${file.name.slice(0, 24)}` : "Escolher foto de consulta"}
        </button>
        <button
          onClick={run}
          disabled={loading}
          className="flex items-center gap-2 rounded-lg gold-gradient px-4 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-60"
        >
          {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Diagnosticar
        </button>
      </div>

      {result && !result.found && (
        <p className="mt-4 text-xs text-destructive">Peça {result.code} não encontrada.</p>
      )}
      {result && result.found && (
        <div className="mt-4 rounded-lg border border-border bg-background/50 p-4 text-xs space-y-1">
          <div>
            Peça <b>{result.code}</b> · categoria: <b>{result.category ?? "—"}</b> · produto:{" "}
            {result.productCode ?? "—"}
          </div>
          <div>
            Vetor de busca:{" "}
            <b className={result.hasVector ? "text-[color:var(--gold)]" : "text-destructive"}>
              {result.hasVector ? "existe" : "AUSENTE (a peça nunca aparece na busca por foto)"}
            </b>
          </div>
          {result.self && (
            <div>
              Busca com a própria foto do catálogo: posição{" "}
              <b>{result.self.rank ?? "fora do índice"}</b>{" "}
              {result.self.rank === 1 ? "(índice alcança a peça)" : "(esperado: 1)"}
            </div>
          )}
          {q && (
            <>
              <div className="pt-2 font-semibold text-[color:var(--gold)]">Com a sua foto</div>
              <div>
                Sem categoria: posição <b>{q.all.rank ?? "acima de 500"}</b> · similaridade{" "}
                {pct(q.all.similarity)} (1º lugar: {pct(q.all.top1)}, 36º: {pct(q.all.top36)})
              </div>
              <div>
                Na categoria da peça: posição <b>{q.inCategory.rank ?? "acima de 500"}</b> ·
                similaridade {pct(q.inCategory.similarity)}
              </div>
              {q.all.sameProductAbove > 0 && (
                <div>Outras fotos do mesmo produto acima: {q.all.sameProductAbove}</div>
              )}
              <div className="pt-1 text-muted-foreground">
                {q.all.rank && q.all.rank <= 36
                  ? "A peça aparece na busca padrão (36 resultados)."
                  : q.inCategory.rank && q.inCategory.rank <= 36
                    ? "Só aparece escolhendo a categoria: outras peças parecidas ocupam o topo."
                    : "Mesmo na categoria a peça fica longe: a foto de consulta é muito diferente da foto do catálogo."}
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
