import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { searchByImage, searchByText } from "@/lib/pieces.functions";
import { getSignedImageUrls } from "@/lib/storage";
import { Search, Upload, X, Loader2, Camera, Image as ImageIcon } from "lucide-react";
import { toast } from "sonner";
import { useIsMobile } from "@/hooks/use-mobile";


export const Route = createFileRoute("/_authenticated/consulta")({
  component: ConsultaPage,
});

type Piece = {
  id: string;
  code: string;
  name: string | null;
  image_path: string;
  category?: string | null;
  similarity?: number;
  created_at?: string | null;
};

type SortMode = "similar" | "recent";

const CATEGORIES = [
  { value: "", label: "Todas" },
  { value: "anel", label: "Anéis" },
  { value: "pingente", label: "Pingentes" },
] as const;

const LIMIT_OPTIONS = [36, 48, 60] as const;


async function fileToDataUrl(file: File): Promise<string> {
  return await new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(r.error);
    r.readAsDataURL(file);
  });
}

function ConsultaPage() {
  const searchImage = useServerFn(searchByImage);
  const searchText = useServerFn(searchByText);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Piece[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<"idle" | "text" | "image">("idle");
  const [preview, setPreview] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const isMobile = useIsMobile();
  const [category, setCategory] = useState<string>("");
  const [imageLimit, setImageLimit] = useState<number>(36);
  const [sortMode, setSortMode] = useState<SortMode>("similar");



  const hydrateUrls = useCallback(async (rows: Piece[]) => {
    const paths = rows.map((r) => r.image_path);
    try {
      const map = await getSignedImageUrls(paths);
      setUrls((prev) => ({ ...prev, ...map }));
    } catch (e) {
      console.error(e);
    }
  }, []);

  async function doTextSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!q.trim()) return;
    setLoading(true);
    setMode("text");
    setPreview(null);
    try {
      const rows = (await searchText({ data: { q: q.trim(), limit: 40, category: category || undefined } })) as Piece[];
      setResults(rows);
      hydrateUrls(rows);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro na busca");
    } finally {
      setLoading(false);
    }
  }

  async function doImageSearch(file: File) {
    if (file.size > 8 * 1024 * 1024) {
      toast.error("Imagem muito grande (máx 8MB)");
      return;
    }
    setLoading(true);
    setMode("image");
    try {
      const dataUrl = await fileToDataUrl(file);
      setPreview(dataUrl);
      const rows = (await searchImage({
        data: { imageDataUrl: dataUrl, limit: imageLimit, category: category || undefined },
      })) as Piece[];
      setResults(rows);
      hydrateUrls(rows);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro na busca por imagem");
    } finally {
      setLoading(false);
    }
  }

  function clearSearch() {
    setResults([]);
    setPreview(null);
    setQ("");
    setMode("idle");
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="text-center mb-8">
        <h1 className="serif text-3xl md:text-4xl gold-text">Consulta de Peças</h1>
        <p className="text-sm text-muted-foreground mt-2">
          Envie uma foto ou digite o código da peça
        </p>
      </div>

      <div className="flex gap-2 justify-center mb-6 flex-wrap">
        {CATEGORIES.map((c) => (
          <button
            key={c.value || "all"}
            onClick={() => setCategory(c.value)}
            className={`rounded-full px-4 py-1.5 text-xs border transition ${
              category === c.value
                ? "gold-gradient text-primary-foreground border-transparent"
                : "border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>

      <div className="flex items-center justify-center gap-2 mb-6">
        <span className="text-xs text-muted-foreground">Resultados por busca:</span>
        {LIMIT_OPTIONS.map((n) => (
          <button
            key={n}
            onClick={() => setImageLimit(n)}
            className={`rounded-full px-3 py-1 text-xs border transition ${
              imageLimit === n
                ? "gold-gradient text-primary-foreground border-transparent"
                : "border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            {n}
          </button>
        ))}
      </div>



      <div className="grid md:grid-cols-2 gap-3 max-w-3xl mx-auto">
        <form onSubmit={doTextSearch} className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Código da peça (ex: AND00196)"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="w-full rounded-lg bg-card border border-border pl-10 pr-24 py-3 text-sm focus:outline-none focus:border-[color:var(--gold)]"
          />
          <button
            type="submit"
            disabled={loading || !q.trim()}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md gold-gradient px-4 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
          >
            Buscar
          </button>
        </form>

        {isMobile ? (
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => cameraRef.current?.click()}
              disabled={loading}
              className="rounded-lg border-2 border-dashed border-[color:var(--gold)]/40 bg-card/40 py-3 px-3 text-sm hover:bg-[color:var(--gold)]/10 transition flex items-center justify-center gap-2 disabled:opacity-50"
            >
              <Camera className="h-4 w-4 text-[color:var(--gold)]" />
              Tirar foto
            </button>
            <button
              onClick={() => fileRef.current?.click()}
              disabled={loading}
              className="rounded-lg border-2 border-dashed border-[color:var(--gold)]/40 bg-card/40 py-3 px-3 text-sm hover:bg-[color:var(--gold)]/10 transition flex items-center justify-center gap-2 disabled:opacity-50"
            >
              <ImageIcon className="h-4 w-4 text-[color:var(--gold)]" />
              Da galeria
            </button>
          </div>
        ) : (
          <button
            onClick={() => fileRef.current?.click()}
            disabled={loading}
            className="rounded-lg border-2 border-dashed border-[color:var(--gold)]/40 bg-card/40 py-3 px-4 text-sm hover:bg-[color:var(--gold)]/10 transition flex items-center justify-center gap-2 disabled:opacity-50"
          >
            <Upload className="h-4 w-4 text-[color:var(--gold)]" />
            Enviar foto para busca visual
          </button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) doImageSearch(f);
            e.target.value = "";
          }}
        />
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) doImageSearch(f);
            e.target.value = "";
          }}
        />
      </div>

      {preview && (
        <div className="mt-6 flex justify-center">
          <div className="relative">
            <img src={preview} alt="Sua foto" className="h-40 w-40 object-cover rounded-lg border border-[color:var(--gold)]/40" />
            <button
              onClick={clearSearch}
              className="absolute -top-2 -right-2 rounded-full bg-card border border-border p-1 hover:bg-destructive/20"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      <div className="mt-10">
        {loading && (
          <div className="flex justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-[color:var(--gold)]" />
          </div>
        )}

        {!loading && mode !== "idle" && results.length === 0 && (
          <div className="text-center py-16 text-muted-foreground">
            Nenhuma peça encontrada.
          </div>
        )}

        {!loading && results.length > 0 && (
          <>
            <div className="text-sm text-muted-foreground mb-4">
              {results.length} {mode === "image" ? "peça(s) mais parecida(s)" : "peça(s) encontrada(s)"}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
              {results.map((p) => (
                <PieceCard key={p.id} piece={p} url={urls[p.image_path]} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function PieceCard({ piece, url }: { piece: Piece; url?: string }) {
  const sim = piece.similarity != null ? Math.round(piece.similarity * 100) : null;
  return (
    <div className="group rounded-lg overflow-hidden border border-border bg-card hover:border-[color:var(--gold)]/60 transition">
      <div className="aspect-square bg-background/60 overflow-hidden">
        {url ? (
          <img
            src={url}
            alt={piece.code}
            loading="lazy"
            className="h-full w-full object-cover group-hover:scale-105 transition duration-500"
          />
        ) : (
          <div className="h-full w-full animate-pulse bg-muted" />
        )}
      </div>
      <div className="p-3 flex items-center justify-between">
        <div className="text-sm font-medium tracking-wide">{piece.code}</div>
        {sim != null && (
          <div className="text-xs text-[color:var(--gold)]">{sim}%</div>
        )}
      </div>
    </div>
  );
}
