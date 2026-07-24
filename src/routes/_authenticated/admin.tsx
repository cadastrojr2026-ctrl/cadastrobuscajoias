import { createFileRoute } from "@tanstack/react-router";
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
import { listApprovals, setApprovalStatus } from "@/lib/approvals.functions";
import { getSignedImageUrls } from "@/lib/storage";
import { toast } from "sonner";
import { Trash2, Loader2, FolderUp, Check, X, UserCheck } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin")({
  component: AdminPage,
});

type Piece = {
  id: string;
  code: string;
  name: string | null;
  image_path: string;
  category: string | null;
  created_at: string;
};

// Alphabetical order
const CATEGORIES = [
  { value: "acessorio", label: "Acessórios" },
  { value: "anel", label: "Anéis" },
  { value: "argola", label: "Argolas" },
  { value: "cmb", label: "CMB" },
  { value: "pingente", label: "Pingentes" },
] as const;


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
  const approvalsFn = useServerFn(listApprovals);
  const setApprovalFn = useServerFn(setApprovalStatus);
  const qc = useQueryClient();

  const [filter, setFilter] = useState<string>("");
  const [uploadCategory, setUploadCategory] = useState<string>("anel");
  const [approvalTab, setApprovalTab] = useState<"pending" | "approved" | "rejected">("pending");

  const { data: role } = useQuery({ queryKey: ["my-role"], queryFn: () => roleFn() });
  const { data: pieces = [], isLoading } = useQuery({
    queryKey: ["all-pieces", filter],
    queryFn: () => listFn({ data: { category: filter || undefined } }) as Promise<Piece[]>,
    enabled: role?.isAdmin === true,
  });
  const { data: counts } = useQuery({
    queryKey: ["pieces-count"],
    queryFn: () => countFn(),
    enabled: role?.isAdmin === true,
  });
  const { data: approvals = [] } = useQuery({
    queryKey: ["approvals", approvalTab],
    queryFn: () => approvalsFn({ data: { status: approvalTab } }),
    enabled: role?.isAdmin === true,
    refetchInterval: 15_000,
  });
  const { data: pendingCount = [] } = useQuery({
    queryKey: ["approvals", "pending"],
    queryFn: () => approvalsFn({ data: { status: "pending" } }),
    enabled: role?.isAdmin === true,
    refetchInterval: 15_000,
  });

  const [urls, setUrls] = useState<Record<string, string>>({});
  useEffect(() => {
    if (pieces.length === 0) return;
    const paths = pieces.map((p) => p.image_path);
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

  const approveMut = useMutation({
    mutationFn: (v: { userId: string; status: "approved" | "rejected" | "pending" }) =>
      setApprovalFn({ data: v }),
    onSuccess: () => {
      toast.success("Status atualizado");
      qc.invalidateQueries({ queryKey: ["approvals"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro"),
  });

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
        await addFn({ data: { code, imageDataUrl: dataUrl, category: uploadCategory } });
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
    qc.invalidateQueries({ queryKey: ["pieces-count"] });
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
    <div className="mx-auto max-w-6xl px-4 py-10">
      <div className="text-center mb-6">
        <h1 className="serif text-4xl md:text-5xl gold-text">Painel Admin</h1>
        <div className="flex items-center justify-center gap-3 my-3 opacity-70">
          <span className="h-px w-16 sm:w-24 bg-[color:var(--gold)]/40" />
          <span className="rotate-45 h-2 w-2 bg-[color:var(--gold)]/70" />
          <span className="h-px w-16 sm:w-24 bg-[color:var(--gold)]/40" />
        </div>
        <p className="text-sm text-muted-foreground">
          {counts?.total ?? pieces.length} peça(s) no total
          {counts?.byCategory && Object.keys(counts.byCategory).length > 0 && (
            <span className="ml-2">
              (
              {CATEGORIES.map((c, i) => (
                <span key={c.value}>
                  {i > 0 && " · "}
                  {c.label}: {counts.byCategory[c.value] ?? 0}
                </span>
              ))}
              )
            </span>
          )}
        </p>
      </div>

      <div className="flex gap-2 items-center flex-wrap justify-center mb-8">
        <select
          value={uploadCategory}
          onChange={(e) => setUploadCategory(e.target.value)}
          disabled={uploading}
          className="rounded-lg bg-card border border-[color:var(--gold)]/30 px-4 py-2.5 text-sm focus:outline-none focus:border-[color:var(--gold)]"
        >
          {CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>
              Categoria: {c.label}
            </option>
          ))}
        </select>
        <button
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="flex items-center gap-2 rounded-lg gold-gradient px-6 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60 hover:brightness-110 transition"
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

      {/* Approvals section */}
      <section className="mb-8 rounded-xl border border-border bg-card/60 backdrop-blur p-5">
        <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
          <div className="flex items-center gap-2">
            <UserCheck className="h-5 w-5 text-[color:var(--gold)]" />
            <h2 className="serif text-xl gold-text">Aprovações de acesso</h2>
            {pendingCount.length > 0 && (
              <span className="ml-2 rounded-full bg-[color:var(--gold)]/20 text-[color:var(--gold)] text-xs px-2 py-0.5">
                {pendingCount.length} pendente(s)
              </span>
            )}
          </div>
          <div className="flex gap-2">
            {(["pending", "approved", "rejected"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setApprovalTab(s)}
                className={`rounded-full px-3 py-1 text-xs border transition ${
                  approvalTab === s
                    ? "gold-gradient text-primary-foreground border-transparent"
                    : "border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                {s === "pending" ? "Pendentes" : s === "approved" ? "Aprovados" : "Rejeitados"}
              </button>
            ))}
          </div>
        </div>

        {approvals.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">Nenhum usuário nesta categoria.</p>
        ) : (
          <div className="divide-y divide-border/60">
            {approvals.map((u) => (
              <div key={u.user_id} className="flex items-center justify-between py-3 gap-3 flex-wrap">
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{u.email || "(sem email)"}</div>
                  <div className="text-xs text-muted-foreground">
                    Cadastrado em {new Date(u.created_at).toLocaleString("pt-BR")}
                  </div>
                </div>
                <div className="flex gap-2">
                  {approvalTab !== "approved" && (
                    <button
                      onClick={() => approveMut.mutate({ userId: u.user_id, status: "approved" })}
                      disabled={approveMut.isPending}
                      className="flex items-center gap-1 rounded-md gold-gradient px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-60"
                    >
                      <Check className="h-3.5 w-3.5" /> Aprovar
                    </button>
                  )}
                  {approvalTab !== "rejected" && (
                    <button
                      onClick={() => approveMut.mutate({ userId: u.user_id, status: "rejected" })}
                      disabled={approveMut.isPending}
                      className="flex items-center gap-1 rounded-md border border-destructive/60 text-destructive px-3 py-1.5 text-xs font-medium hover:bg-destructive/10 disabled:opacity-60"
                    >
                      <X className="h-3.5 w-3.5" /> Rejeitar
                    </button>
                  )}
                  {approvalTab !== "pending" && (
                    <button
                      onClick={() => approveMut.mutate({ userId: u.user_id, status: "pending" })}
                      disabled={approveMut.isPending}
                      className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-60"
                    >
                      Voltar p/ pendente
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="flex gap-2 mb-6 flex-wrap">
        <button
          onClick={() => setFilter("")}
          className={`rounded-full px-4 py-1.5 text-xs border transition ${
            filter === ""
              ? "gold-gradient text-primary-foreground border-transparent"
              : "border-border text-muted-foreground hover:text-foreground"
          }`}
        >
          Todas
        </button>
        {CATEGORIES.map((c) => (
          <button
            key={c.value}
            onClick={() => setFilter(c.value)}
            className={`rounded-full px-4 py-1.5 text-xs border transition ${
              filter === c.value
                ? "gold-gradient text-primary-foreground border-transparent"
                : "border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            {c.label}
          </button>
        ))}
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
