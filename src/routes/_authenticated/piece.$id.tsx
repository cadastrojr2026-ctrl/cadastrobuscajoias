import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { getPieceById, searchByImage } from "@/lib/pieces.functions";
import { getSignedImageUrls } from "@/lib/storage";
import {
  ArrowLeft,
  Sparkles,
  Loader2,
  Tag,
  Calendar,
  Hash,
  X,
  Gem,
  Circle,
  CircleDashed,
  Link as LinkIcon,
  LayoutGrid,
} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/piece/$id")({
  component: PieceDetailPage,
});

type SimilarPiece = {
  id: string;
  code: string;
  name: string | null;
  image_path: string;
  category?: string | null;
  similarity?: number;
};

const CATEGORY_META: Record<string, { label: string; icon: React.ComponentType<{ className?: string }> }> = {
  acessorio: { label: "Acessórios", icon: Gem },
  anel: { label: "Anéis", icon: Circle },
  argola: { label: "Argolas", icon: CircleDashed },
  cmb: { label: "CMB", icon: LinkIcon },
  pingente: { label: "Pingentes", icon: Gem },
};

function extractKeywords(piece: {
  code: string;
  name: string | null;
  category: string | null;
  description?: string | null;
}): string[] {
  const set = new Set<string>();
  if (piece.category && CATEGORY_META[piece.category]) {
    set.add(CATEGORY_META[piece.category].label);
  }
  // Prefix from code (letters before digits) — e.g. AND00196 → AND
  const prefix = piece.code.match(/^[A-Za-z]+/)?.[0];
  if (prefix) set.add(prefix.toUpperCase());
  const parts = `${piece.name ?? ""} ${piece.description ?? ""}`
    .split(/[\s,;/\-_]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 3 && s.length <= 24);
  for (const p of parts) set.add(p);
  return Array.from(set).slice(0, 12);
}

async function urlToDataUrl(url: string): Promise<string> {
  const res = await fetch(url);
  const blob = await res.blob();
  return await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

function PieceDetailPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const getPiece = useServerFn(getPieceById);
  const searchImage = useServerFn(searchByImage);

  const { data: piece, isLoading, error } = useQuery({
    queryKey: ["piece", id],
    queryFn: () => getPiece({ data: { id } }),
  });

  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [similar, setSimilar] = useState<SimilarPiece[]>([]);
  const [similarUrls, setSimilarUrls] = useState<Record<string, string>>({});
  const [searching, setSearching] = useState(false);
  const [lightbox, setLightbox] = useState(false);

  useEffect(() => {
    if (!piece?.image_path) return;
    getSignedImageUrls([piece.image_path])
      .then((m) => setImageUrl(m[piece.image_path] ?? null))
      .catch((e) => console.error(e));
  }, [piece?.image_path]);

  const findSimilar = useCallback(async () => {
    if (!imageUrl || !piece) return;
    setSearching(true);
    try {
      const dataUrl = await urlToDataUrl(imageUrl);
      const rows = (await searchImage({
        data: { imageDataUrl: dataUrl, limit: 24, category: piece.category ?? undefined },
      })) as SimilarPiece[];
      const filtered = rows.filter((r) => r.id !== piece.id);
      setSimilar(filtered);
      const map = await getSignedImageUrls(filtered.map((r) => r.image_path));
      setSimilarUrls(map);
      // Smooth scroll to results
      setTimeout(() => {
        document.getElementById("similar-results")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 60);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao buscar similares");
    } finally {
      setSearching(false);
    }
  }, [imageUrl, piece, searchImage]);

  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightbox(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightbox]);

  if (isLoading) {
    return (
      <div className="flex justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-[color:var(--gold)]" />
      </div>
    );
  }

  if (error || !piece) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center">
        <p className="text-muted-foreground mb-4">
          {error instanceof Error ? error.message : "Peça não encontrada."}
        </p>
        <Link to="/consulta" className="text-[color:var(--gold)] hover:underline">
          Voltar para a consulta
        </Link>
      </div>
    );
  }

  const CategoryIcon = piece.category ? CATEGORY_META[piece.category]?.icon ?? LayoutGrid : LayoutGrid;
  const categoryLabel = piece.category ? CATEGORY_META[piece.category]?.label ?? piece.category : "—";
  const keywords = extractKeywords(piece);
  const createdAt = piece.created_at ? new Date(piece.created_at).toLocaleDateString("pt-BR") : null;

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <button
        onClick={() => navigate({ to: "/consulta" })}
        className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-6"
      >
        <ArrowLeft className="h-4 w-4" />
        Voltar
      </button>

      <div className="grid md:grid-cols-2 gap-8">
        {/* Gallery */}
        <div className="space-y-3">
          <div
            className="aspect-square rounded-xl overflow-hidden border border-[color:var(--gold)]/30 bg-card cursor-zoom-in"
            onClick={() => imageUrl && setLightbox(true)}
          >
            {imageUrl ? (
              <img src={imageUrl} alt={piece.code} className="h-full w-full object-cover" />
            ) : (
              <div className="h-full w-full animate-pulse bg-muted" />
            )}
          </div>
          <div className="grid grid-cols-4 gap-2">
            {[imageUrl].filter(Boolean).map((u, i) => (
              <button
                key={i}
                onClick={() => setLightbox(true)}
                className="aspect-square rounded-lg overflow-hidden border border-[color:var(--gold)]/30 hover:border-[color:var(--gold)] transition"
              >
                <img src={u!} alt="" className="h-full w-full object-cover" />
              </button>
            ))}
          </div>
        </div>

        {/* Info */}
        <div className="space-y-6">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-[color:var(--gold)]/40 bg-card/60 px-3 py-1 text-xs text-[color:var(--gold)] mb-3">
              <CategoryIcon className="h-3.5 w-3.5" />
              {categoryLabel}
            </div>
            <h1 className="serif text-3xl md:text-4xl gold-text mb-2">{piece.code}</h1>
            {piece.name && <p className="text-muted-foreground">{piece.name}</p>}
          </div>

          <dl className="space-y-3 text-sm">
            <div className="flex items-start gap-3">
              <Hash className="h-4 w-4 text-[color:var(--gold)] mt-0.5" />
              <div>
                <dt className="text-xs text-muted-foreground">Código</dt>
                <dd className="font-medium tracking-wide">{piece.code}</dd>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Tag className="h-4 w-4 text-[color:var(--gold)] mt-0.5" />
              <div>
                <dt className="text-xs text-muted-foreground">Categoria</dt>
                <dd className="font-medium">{categoryLabel}</dd>
              </div>
            </div>
            {createdAt && (
              <div className="flex items-start gap-3">
                <Calendar className="h-4 w-4 text-[color:var(--gold)] mt-0.5" />
                <div>
                  <dt className="text-xs text-muted-foreground">Cadastrada em</dt>
                  <dd className="font-medium">{createdAt}</dd>
                </div>
              </div>
            )}
          </dl>

          {keywords.length > 0 && (
            <div>
              <div className="text-xs text-muted-foreground mb-2">Palavras-chave</div>
              <div className="flex flex-wrap gap-2">
                {keywords.map((k) => (
                  <span
                    key={k}
                    className="rounded-full border border-[color:var(--gold)]/30 bg-card/60 px-3 py-1 text-xs text-foreground/80"
                  >
                    {k}
                  </span>
                ))}
              </div>
            </div>
          )}

          <button
            onClick={findSimilar}
            disabled={!imageUrl || searching}
            className="w-full inline-flex items-center justify-center gap-2 rounded-lg gold-gradient px-6 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50 transition hover:brightness-110"
          >
            {searching ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Buscando similares...
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" />
                Buscar peças similares
              </>
            )}
          </button>
        </div>
      </div>

      {/* Similar results */}
      {similar.length > 0 && (
        <div id="similar-results" className="mt-14">
          <h2 className="serif text-2xl gold-text mb-4">Peças similares</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {similar.map((p) => {
              const sim = p.similarity != null ? Math.round(p.similarity * 100) : null;
              const url = similarUrls[p.image_path];
              return (
                <Link
                  key={p.id}
                  to="/piece/$id"
                  params={{ id: p.id }}
                  className="group rounded-lg overflow-hidden border border-border bg-card hover:border-[color:var(--gold)]/60 transition"
                >
                  <div className="aspect-square bg-background/60 overflow-hidden">
                    {url ? (
                      <img
                        src={url}
                        alt={p.code}
                        loading="lazy"
                        className="h-full w-full object-cover group-hover:scale-105 transition duration-500"
                      />
                    ) : (
                      <div className="h-full w-full animate-pulse bg-muted" />
                    )}
                  </div>
                  <div className="p-3 flex items-center justify-between">
                    <div className="text-sm font-medium tracking-wide">{p.code}</div>
                    {sim != null && <div className="text-xs text-[color:var(--gold)]">{sim}%</div>}
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {lightbox && imageUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setLightbox(false)}
          role="dialog"
          aria-modal="true"
        >
          <button
            onClick={() => setLightbox(false)}
            className="absolute top-4 right-4 rounded-full bg-card/80 border border-border p-2 hover:bg-destructive/20 transition"
            aria-label="Fechar"
          >
            <X className="h-5 w-5" />
          </button>
          <img
            src={imageUrl}
            alt={piece.code}
            onClick={(e) => e.stopPropagation()}
            className="max-h-[85vh] max-w-[90vw] rounded-lg border border-[color:var(--gold)]/40 object-contain shadow-2xl"
          />
        </div>
      )}
    </div>
  );
}
