import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addPiece,
  countPieces,
  deletePiece,
  getMyRole,
  listAllPieces,
} from "@/lib/pieces.functions";
import { getSignedImageUrls } from "@/lib/storage";
import { toast } from "sonner";
import { Trash2, Upload, Loader2, FolderUp } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/admin")({
  component: AdminPage,
});

type Piece = {
  id: string;
  code: string;
  name: string | null;
  image_path: string;
  created_at: string;
};

async function fileToDataUrl(file: File): Promise<string> {
  return await new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(r.error);
    r.readAsDataURL(file);
  });
}

function codeFromFilename(name: string): string {
  const base = name.replace(/\.[^.]+$/, "");
  const m = base.match(/([A-Za-z]+\d+)/);
  return (m ? m[1] : base).toUpperCase();
}

function AdminPage() {
  const roleFn = useServerFn(getMyRole);
  const listFn = useServerFn(listAllPieces);
  const countFn = useServerFn(countPieces);
  const addFn = useServerFn(addPiece);
  const deleteFn = useServerFn(deletePiece);
  const qc = useQueryClient();

  const { data: role } = useQuery({ queryKey: ["my-role"], queryFn: () => roleFn() });
  const { data: pieces = [], isLoading } = useQuery({
    queryKey: ["all-pieces"],
    queryFn: () => listFn() as Promise<Piece[]>,
    enabled: role?.isAdmin === true,
  });
  const { data: totalCount } = useQuery({
    queryKey: ["pieces-count"],
    queryFn: () => countFn(),
    enabled: role?.isAdmin === true,
  });

  const [urls, setUrls] = useState<Record<string, string>>({});
  useEffect(() => {
    if (pieces.length === 0) return;
    const paths = pieces.map((p) => p.image_path);
    // signed URLs in chunks of 100
    (async () => {
      const chunks: string[][] = [];
      for (let i = 0; i < paths.length; i += 100) chunks.push(paths.slice(i, i + 100));
      for (const c of chunks) {
        const m = await getSignedImageUrls(c);
        setUrls((prev) => ({ ...prev, ...m }));
      }
    })();
  }, [pieces]);

  const del = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Peça removida");
      qc.invalidateQueries({ queryKey: ["all-pieces"] });
      qc.invalidateQueries({ queryKey: ["pieces-count"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro"),
  });

  // Upload state
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploadQueue, setUploadQueue] = useState<{ name: string; status: "pending" | "ok" | "error"; msg?: string }[]>([]);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });

  async function processFiles(files: File[]) {
    if (files.length === 0) return;
    setUploading(true);
    setProgress({ done: 0, total: files.length });
    const queue = files.map((f) => ({ name: f.name, status: "pending" as const }));
    setUploadQueue(queue);

    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const code = codeFromFilename(f.name);
      try {
        const dataUrl = await fileToDataUrl(f);
        await addFn({ data: { code, imageDataUrl: dataUrl, category: "anel" } });
        setUploadQueue((prev) => {
          const c = [...prev];
          c[i] = { ...c[i], status: "ok" };
          return c;
        });
      } catch (err) {
        setUploadQueue((prev) => {
          const c = [...prev];
          c[i] = { ...c[i], status: "error", msg: err instanceof Error ? err.message : "erro" };
          return c;
        });
      }
      setProgress({ done: i + 1, total: files.length });
    }
    setUploading(false);
    qc.invalidateQueries({ queryKey: ["all-pieces"] });
    toast.success("Upload concluído");
  }

  if (role && !role.isAdmin) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center">
        <h1 className="serif text-3xl gold-text">Acesso restrito</h1>
        <p className="mt-4 text-muted-foreground">
          Esta área é apenas para administradores.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="flex items-end justify-between flex-wrap gap-4 mb-6">
        <div>
          <h1 className="serif text-3xl gold-text">Painel Admin</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {pieces.length} peça(s) cadastrada(s)
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="flex items-center gap-2 rounded-md gold-gradient px-5 py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-60"
          >
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <FolderUp className="h-4 w-4" />}
            Enviar fotos (pasta)
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            /* @ts-expect-error webkitdirectory */
            webkitdirectory=""
            directory=""
            className="hidden"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []).filter((f) => f.type.startsWith("image/"));
              processFiles(files);
              e.target.value = "";
            }}
          />
        </div>
      </div>

      {uploading && (
        <div className="mb-6 rounded-lg border border-[color:var(--gold)]/40 bg-card p-4">
          <div className="flex items-center justify-between text-sm mb-2">
            <span>Enviando peças...</span>
            <span className="text-[color:var(--gold)]">
              {progress.done} / {progress.total}
            </span>
          </div>
          <div className="h-2 rounded-full bg-background overflow-hidden">
            <div
              className="h-full gold-gradient transition-all"
              style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }}
            />
          </div>
        </div>
      )}

      {uploadQueue.length > 0 && !uploading && (
        <div className="mb-6 rounded-lg border border-border bg-card p-4 max-h-40 overflow-auto text-xs">
          {uploadQueue.filter((q) => q.status === "error").length > 0 && (
            <div className="text-destructive mb-2">
              {uploadQueue.filter((q) => q.status === "error").length} erro(s):
            </div>
          )}
          {uploadQueue
            .filter((q) => q.status === "error")
            .map((q) => (
              <div key={q.name}>
                {q.name}: {q.msg}
              </div>
            ))}
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-[color:var(--gold)]" />
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
          {pieces.map((p) => (
            <div key={p.id} className="group rounded-lg overflow-hidden border border-border bg-card">
              <div className="aspect-square bg-background/60 relative">
                {urls[p.image_path] ? (
                  <img src={urls[p.image_path]} alt={p.code} loading="lazy" className="h-full w-full object-cover" />
                ) : (
                  <div className="h-full w-full animate-pulse bg-muted" />
                )}
                <button
                  onClick={() => {
                    if (confirm(`Remover peça ${p.code}?`)) del.mutate(p.id);
                  }}
                  className="absolute top-1.5 right-1.5 rounded-full bg-background/80 backdrop-blur p-1.5 opacity-0 group-hover:opacity-100 hover:bg-destructive transition"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="p-2 text-center text-xs font-medium tracking-wide">{p.code}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
