import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { searchByImage, searchByText } from "@/lib/pieces.functions";
import {
  listFavorites,
  listFavoriteIds,
  addFavorite,
  removeFavorite,
} from "@/lib/favorites.functions";
import { getSignedImageUrls } from "@/lib/storage";
import {
  Search,
  Upload,
  X,
  Loader2,
  Camera,
  Image as ImageIcon,
  LayoutGrid,
  Circle,
  CircleDashed,
  Link as LinkIcon,
  Gem,
  Lightbulb,
  Tag,
  ShieldCheck,
  Star,
} from "lucide-react";
import {
  NecklaceIcon,
  PendantIcon,
  BraceletIcon,
} from "@/components/jewelry-icons";
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

// Alphabetical order
const CATEGORIES = [
  { value: "", label: "Todas", icon: LayoutGrid },
  { value: "acessorio", label: "Acessórios", icon: Gem },
  { value: "anel", label: "Anéis", icon: Circle },
  { value: "argola", label: "Argolas", icon: CircleDashed },
  { value: "brinco_fixo", label: "Brincos Fixos", icon: Gem },
  { value: "brinco_medio", label: "Brincos Médios", icon: Gem },
  { value: "cmb", label: "CMB", icon: LinkIcon },
  { value: "gaf", label: "GAF", icon: NecklaceIcon },
  { value: "pingente", label: "Pingentes", icon: PendantIcon },
  { value: "pulseira_infantil", label: "Pulseiras Infantis", icon: BraceletIcon },
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

function Divider() {
  return (
    <div className="flex items-center justify-center gap-3 my-2 opacity-70">
      <span className="h-px w-16 sm:w-24 bg-[color:var(--gold)]/40" />
      <span className="rotate-45 h-2 w-2 bg-[color:var(--gold)]/70" />
      <span className="h-px w-16 sm:w-24 bg-[color:var(--gold)]/40" />
    </div>
  );
}

function ConsultaPage() {
  const searchImage = useServerFn(searchByImage);
  const searchText = useServerFn(searchByText);
  const listFavs = useServerFn(listFavorites);
  const listFavIds = useServerFn(listFavoriteIds);
  const addFav = useServerFn(addFavorite);
  const removeFav = useServerFn(removeFavorite);
  const queryClient = useQueryClient();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Piece[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<"idle" | "text" | "image">("idle");
  const [view, setView] = useState<"search" | "favorites">("search");
  const [preview, setPreview] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const isMobile = useIsMobile();
  const [category, setCategory] = useState<string>("");
  const [imageLimit, setImageLimit] = useState<number>(36);
  const [sortMode, setSortMode] = useState<SortMode>("similar");
  const [lightbox, setLightbox] = useState<{ piece: Piece; url: string } | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const favIdsQuery = useQuery({
    queryKey: ["favorite-ids"],
    queryFn: () => listFavIds(),
    staleTime: 30_000,
  });
  const favIds = useMemo(() => new Set(favIdsQuery.data ?? []), [favIdsQuery.data]);

  const favoritesQuery = useQuery({
    queryKey: ["favorites"],
    queryFn: () => listFavs(),
    enabled: view === "favorites",
    staleTime: 30_000,
  });

  useEffect(() => {
    if (view === "favorites" && favoritesQuery.data) {
      hydrateUrls(favoritesQuery.data as Piece[]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, favoritesQuery.data]);

  const toggleFav = useMutation({
    mutationFn: async ({ pieceId, isFav }: { pieceId: string; isFav: boolean }) => {
      if (isFav) await removeFav({ data: { pieceId } });
      else await addFav({ data: { pieceId } });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["favorite-ids"] });
      queryClient.invalidateQueries({ queryKey: ["favorites"] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Erro"),
  });

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

  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightbox(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightbox]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      {/* Hero */}
      <div className="text-center mb-8">
        <h1 className="serif text-4xl md:text-5xl gold-text">Consulta de Peças</h1>
        <Divider />
        <p className="text-sm md:text-base text-muted-foreground">
          Envie uma foto ou digite o código da peça
        </p>
      </div>

      {/* View toggle */}
      <div className="flex justify-center mb-6">
        <div className="inline-flex rounded-full border border-[color:var(--gold)]/30 bg-card/40 p-1">
          <button
            onClick={() => setView("search")}
            className={`flex items-center gap-2 rounded-full px-4 py-1.5 text-sm transition ${
              view === "search"
                ? "gold-gradient text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Search className="h-4 w-4" /> Buscar
          </button>
          <button
            onClick={() => setView("favorites")}
            className={`flex items-center gap-2 rounded-full px-4 py-1.5 text-sm transition ${
              view === "favorites"
                ? "gold-gradient text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Star className="h-4 w-4" />
            Favoritos
            {favIdsQuery.data && favIdsQuery.data.length > 0 && (
              <span className="rounded-full bg-black/20 px-1.5 text-xs">
                {favIdsQuery.data.length}
              </span>
            )}
          </button>
        </div>
      </div>


      {view === "search" && (<>
      {/* Categories (alphabetical) */}
      <div className="flex gap-2 justify-center mb-6 flex-wrap">

        {CATEGORIES.map((c) => {
          const Icon = c.icon;
          const active = category === c.value;
          return (
            <button
              key={c.value || "all"}
              onClick={() => setCategory(c.value)}
              className={`flex items-center gap-2 rounded-full px-5 py-2 text-sm border transition ${
                active
                  ? "gold-gradient text-primary-foreground border-transparent shadow-md shadow-black/30"
                  : "border-[color:var(--gold)]/30 text-foreground/80 hover:text-foreground hover:border-[color:var(--gold)]/60 bg-card/40"
              }`}
            >
              <Icon className="h-4 w-4" />
              {c.label}
            </button>
          );
        })}
      </div>

      {/* Results-per-search */}
      <div className="flex items-center justify-center gap-2 mb-6">
        <span className="text-xs text-muted-foreground">Resultados por busca:</span>
        {LIMIT_OPTIONS.map((n) => (
          <button
            key={n}
            onClick={() => setImageLimit(n)}
            className={`rounded-full px-4 py-1 text-xs border transition ${
              imageLimit === n
                ? "gold-gradient text-primary-foreground border-transparent"
                : "border-[color:var(--gold)]/30 text-muted-foreground hover:text-foreground"
            }`}
          >
            {n}
          </button>
        ))}
      </div>

      {mode === "image" && (
        <div className="flex items-center justify-center gap-2 mb-6">
          <span className="text-xs text-muted-foreground">Ordenar por:</span>
          {([
            { v: "similar", label: "Mais parecido" },
            { v: "recent", label: "Mais recente" },
          ] as const).map((o) => (
            <button
              key={o.v}
              onClick={() => setSortMode(o.v)}
              className={`rounded-full px-3 py-1 text-xs border transition ${
                sortMode === o.v
                  ? "gold-gradient text-primary-foreground border-transparent"
                  : "border-[color:var(--gold)]/30 text-muted-foreground hover:text-foreground"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}

      {/* Search inputs */}
      <div className="grid md:grid-cols-2 gap-4">
        {/* Text search */}
        <form
          onSubmit={doTextSearch}
          className="relative rounded-xl bg-card/70 border border-border p-2 flex items-center gap-2"
        >
          <Search className="absolute left-5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            placeholder="Código da peça (ex: AND00196)"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="flex-1 bg-transparent pl-8 pr-2 py-3 text-sm focus:outline-none placeholder:text-muted-foreground/70"
          />
          <button
            type="submit"
            disabled={loading || !q.trim()}
            className="rounded-lg gold-gradient px-6 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-50 transition hover:brightness-110"
          >
            Buscar
          </button>
        </form>

        {/* Image upload */}
        {isMobile ? (
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => cameraRef.current?.click()}
              disabled={loading}
              className="rounded-xl border-2 border-dashed border-[color:var(--gold)]/50 bg-card/40 py-4 px-3 text-sm hover:bg-[color:var(--gold)]/10 transition flex flex-col items-center justify-center gap-1.5 disabled:opacity-50"
            >
              <Camera className="h-5 w-5 text-[color:var(--gold)]" />
              Tirar foto
            </button>
            <button
              onClick={() => fileRef.current?.click()}
              disabled={loading}
              className="rounded-xl border-2 border-dashed border-[color:var(--gold)]/50 bg-card/40 py-4 px-3 text-sm hover:bg-[color:var(--gold)]/10 transition flex flex-col items-center justify-center gap-1.5 disabled:opacity-50"
            >
              <ImageIcon className="h-5 w-5 text-[color:var(--gold)]" />
              Da galeria
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              const f = e.dataTransfer.files?.[0];
              if (f && f.type.startsWith("image/")) doImageSearch(f);
            }}
            disabled={loading}
            className={`rounded-xl border-2 border-dashed transition flex items-center justify-center gap-3 py-4 px-5 text-left disabled:opacity-50 ${
              dragOver
                ? "border-[color:var(--gold)] bg-[color:var(--gold)]/10"
                : "border-[color:var(--gold)]/50 bg-card/40 hover:bg-[color:var(--gold)]/5"
            }`}
          >
            <Upload className="h-5 w-5 text-[color:var(--gold)] shrink-0" />
            <div className="flex flex-col">
              <span className="text-sm font-semibold">Enviar foto para busca visual</span>
              <span className="text-xs text-muted-foreground">Arraste e solte ou clique para enviar</span>
            </div>
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

      {/* Tip banner */}
      <div className="mt-8 rounded-2xl border border-[color:var(--gold)]/25 bg-card/60 overflow-hidden">
        <div className="grid md:grid-cols-[1fr_auto] items-center">
          <div className="flex items-start gap-4 p-6">
            <div className="rounded-full border border-[color:var(--gold)]/40 p-2.5 shrink-0">
              <Lightbulb className="h-5 w-5 text-[color:var(--gold)]" />
            </div>
            <div>
              <div className="font-semibold mb-1">Dica para melhores resultados</div>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Utilize fotos nítidas, com boa iluminação e fundo neutro. Quanto mais clara a imagem, mais precisa será a busca.
              </p>
            </div>
          </div>
        </div>
      </div>

      {preview && (
        <div className="mt-8 flex justify-center">
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
      </>)}

      {/* Results / feature strip */}
      <div className="mt-10">

        {view === "search" && loading && (
          <div className="flex justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-[color:var(--gold)]" />
          </div>
        )}

        {view === "search" && !loading && mode !== "idle" && results.length === 0 && (
          <div className="text-center py-16 text-muted-foreground">
            Nenhuma peça encontrada.
          </div>
        )}

        {view === "search" && !loading && results.length > 0 && (
          <>
            <div className="text-sm text-muted-foreground mb-4">
              {results.length}{" "}
              {mode === "image"
                ? sortMode === "recent"
                  ? "peça(s) — mais recentes primeiro"
                  : "peça(s) mais parecida(s)"
                : "peça(s) encontrada(s)"}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
              {[...results]
                .sort((a, b) => {
                  if (mode === "image" && sortMode === "recent") {
                    const at = a.created_at ? Date.parse(a.created_at) : 0;
                    const bt = b.created_at ? Date.parse(b.created_at) : 0;
                    return bt - at;
                  }
                  if (mode === "image") {
                    return (b.similarity ?? 0) - (a.similarity ?? 0);
                  }
                  return 0;
                })
                .map((p) => (
                  <PieceCard
                    key={p.id}
                    piece={p}
                    url={urls[p.image_path]}
                    isFav={favIds.has(p.id)}
                    onToggleFav={() =>
                      toggleFav.mutate({ pieceId: p.id, isFav: favIds.has(p.id) })
                    }
                    onClick={() => {
                      const url = urls[p.image_path];
                      if (url) setLightbox({ piece: p, url });
                    }}
                  />
                ))}
            </div>
          </>
        )}

        {view === "search" && !loading && mode === "idle" && (
          <>
            <Divider />
            <div className="grid sm:grid-cols-3 gap-6 mt-6">
              <FeatureCard
                icon={Camera}
                title="Busca por imagem"
                text="Envie uma foto da peça e encontre similares em segundos."
              />
              <FeatureCard
                icon={Tag}
                title="Busca por código"
                text="Digite o código da peça para localizar rapidamente."
              />
              <FeatureCard
                icon={ShieldCheck}
                title="Resultados precisos"
                text="Tecnologia avançada para encontrar peças com alta precisão."
              />
            </div>
          </>
        )}

        {view === "favorites" && (
          <>
            <div className="text-center mb-6">
              <h2 className="serif text-2xl gold-text">Meus Favoritos</h2>
              <p className="text-sm text-muted-foreground mt-1">
                Peças que você marcou para acessar rapidamente
              </p>
            </div>
            {favoritesQuery.isLoading ? (
              <div className="flex justify-center py-16">
                <Loader2 className="h-8 w-8 animate-spin text-[color:var(--gold)]" />
              </div>
            ) : (favoritesQuery.data ?? []).length === 0 ? (
              <div className="text-center py-16 text-muted-foreground">
                Você ainda não tem peças favoritas. Toque na estrela em qualquer peça para adicioná-la aqui.
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                {((favoritesQuery.data ?? []) as Piece[]).map((p) => (
                  <PieceCard
                    key={p.id}
                    piece={p}
                    url={urls[p.image_path]}
                    isFav={true}
                    onToggleFav={() =>
                      toggleFav.mutate({ pieceId: p.id, isFav: true })
                    }
                    onClick={() => {
                      const url = urls[p.image_path];
                      if (url) setLightbox({ piece: p, url });
                    }}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>


      {lightbox && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setLightbox(null)}
          role="dialog"
          aria-modal="true"
          aria-label={`Peça ${lightbox.piece.code}`}
        >
          <button
            onClick={() => setLightbox(null)}
            className="absolute top-4 right-4 rounded-full bg-card/80 border border-border p-2 text-foreground hover:bg-destructive/20 transition"
            aria-label="Fechar"
          >
            <X className="h-5 w-5" />
          </button>
          <img
            src={lightbox.url}
            alt={lightbox.piece.code}
            className="max-h-[85vh] max-w-[90vw] rounded-lg border border-[color:var(--gold)]/40 object-contain shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}

function FeatureCard({
  icon: Icon,
  title,
  text,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  text: string;
}) {
  return (
    <div className="flex items-start gap-4">
      <div className="rounded-full border border-[color:var(--gold)]/40 bg-card/60 p-3 shrink-0">
        <Icon className="h-5 w-5 text-[color:var(--gold)]" />
      </div>
      <div>
        <div className="font-semibold text-[color:var(--gold)] mb-1">{title}</div>
        <p className="text-sm text-muted-foreground leading-relaxed">{text}</p>
      </div>
    </div>
  );
}

function PieceCard({
  piece,
  url,
  onClick,
  isFav,
  onToggleFav,
}: {
  piece: Piece;
  url?: string;
  onClick?: () => void;
  isFav?: boolean;
  onToggleFav?: () => void;
}) {
  const sim = piece.similarity != null ? Math.round(piece.similarity * 100) : null;
  return (
    <div className="group relative rounded-lg overflow-hidden border border-border bg-card hover:border-[color:var(--gold)]/60 transition">
      <div className="aspect-square bg-background/60 overflow-hidden cursor-pointer" onClick={onClick}>
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
      {onToggleFav && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleFav();
          }}
          aria-label={isFav ? "Remover dos favoritos" : "Adicionar aos favoritos"}
          className={`absolute top-2 right-2 rounded-full p-1.5 backdrop-blur border transition ${
            isFav
              ? "bg-[color:var(--gold)]/90 border-[color:var(--gold)] text-black"
              : "bg-black/50 border-white/20 text-white hover:bg-black/70"
          }`}
        >
          <Star className={`h-4 w-4 ${isFav ? "fill-current" : ""}`} />
        </button>
      )}
      <div className="p-3 flex items-center justify-between">
        <div className="text-sm font-medium tracking-wide">{piece.code}</div>
        {sim != null && (
          <div className="text-xs text-[color:var(--gold)]">{sim}%</div>
        )}
      </div>
    </div>
  );
}

