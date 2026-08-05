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
  renamePiece,
} from "@/lib/pieces.functions";
import { listApprovals, setApprovalStatus } from "@/lib/approvals.functions";
import { usePendingApprovals } from "@/hooks/use-pending-approvals";

import { getSignedImageUrls } from "@/lib/storage";
import { toast } from "sonner";
import {
  Trash2,
  Loader2,
  FolderUp,
  Check,
  X,
  UserCheck,
  RefreshCw,
  Pencil,
  Eraser,

} from "lucide-react";
import { getIndexHealth, syncIndexIncremental } from "@/lib/index-sync.functions";
import { applyCodeCleanup, previewCodeCleanup } from "@/lib/code-cleanup.functions";



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
 { value: "brinco_fixo", label: "Brincos Fixos" },
 { value: "brinco_medio", label: "Brincos Médios" },
  { value: "cmb", label: "CMB" },
  { value: "gaf", label: "GAF" },
  { value: "gargantilha", label: "Gargantilhas" },
  { value: "pingente", label: "Pingentes" },
  { value: "pulseira_infantil", label: "Pulseiras Infantis" },
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
  const renameFn = useServerFn(renamePiece);

  const approvalsFn = useServerFn(listApprovals);
  const setApprovalFn = useServerFn(setApprovalStatus);
  const healthFn = useServerFn(getIndexHealth);
  const syncFn = useServerFn(syncIndexIncremental);
  const previewCleanFn = useServerFn(previewCodeCleanup);
  const applyCleanFn = useServerFn(applyCodeCleanup);
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
  const { data: health } = useQuery({
    queryKey: ["index-health"],
    queryFn: () => healthFn(),
    enabled: role?.isAdmin === true,
  });
  const { data: approvals = [] } = useQuery({
    queryKey: ["approvals", approvalTab],
    queryFn: () => approvalsFn({ data: { status: approvalTab } }),
    enabled: role?.isAdmin === true,
    refetchInterval: 15_000,
  });
  const { data: pending } = usePendingApprovals(role?.isAdmin === true);
  const pendingTotal = pending?.count ?? 0;


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
      toast.success("Peça removida (embedding removido do índice)");
      setSyncReport({
        created: 0,
        updated: 0,
        removed: 1,
        embeddingsCreated: 0,
        embeddingsUpdated: 0,
        embeddingsRemoved: 1,
        errors: [],
      });
      qc.invalidateQueries({ queryKey: ["all-pieces"] });
      qc.invalidateQueries({ queryKey: ["pieces-count"] });
      qc.invalidateQueries({ queryKey: ["index-health"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro"),
  });

  const [renaming, setRenaming] = useState<Piece | null>(null);
  const [renameCode, setRenameCode] = useState("");
  const [renameName, setRenameName] = useState("");

  const renameMut = useMutation({
    mutationFn: (v: { id: string; code: string; name?: string }) => renameFn({ data: v }),
    onSuccess: (r) => {
      toast.success(
        r.previousCode === r.code
          ? `Peça ${r.code} atualizada`
          : `${r.previousCode} renomeada para ${r.code}`,
      );
      setRenaming(null);
      setUrls({});
      qc.invalidateQueries({ queryKey: ["all-pieces"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro"),
  });

  function openRename(p: Piece) {
    setRenaming(p);
    setRenameCode(p.code);
    setRenameName(p.name ?? "");
  }


  const syncMut = useMutation({
    mutationFn: () => syncFn({ data: { limit: 25 } }),
    onSuccess: (r) => {
      setSyncReport({
        created: 0,
        updated: r.embeddingsUpdated,
        removed: 0,
        embeddingsCreated: 0,
        embeddingsUpdated: r.embeddingsUpdated,
        embeddingsRemoved: 0,
        errors: r.errors,
      });
      qc.invalidateQueries({ queryKey: ["index-health"] });
      if (r.processed === 0) toast.success("Índice já está sincronizado");
      else
        toast.success(
          `${r.embeddingsUpdated} embedding(s) atualizado(s) · ${r.failed} erro(s) · restam ${r.remainingWithoutEmbedding}`,
        );
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro"),
  });

  // ---- Limpeza de peso/valor no código ----
  const [cleanPreview, setCleanPreview] = useState<{
    total: number;
    affected: number;
    conflicts: number;
    sample: { from: string; to: string }[];
  } | null>(null);
  const [cleanProgress, setCleanProgress] = useState<{
    renamed: number;
    conflictsResolved: number;
    remaining: number;
    errors: { code: string; message: string }[];
    running: boolean;
  } | null>(null);

  const previewCleanMut = useMutation({
    mutationFn: () => previewCleanFn(),
    onSuccess: (r) => {
      setCleanPreview(r);
      if (r.affected === 0) toast.success("Nenhum código com peso/valor encontrado");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro"),
  });

  async function runCleanup() {
    setCleanProgress({ renamed: 0, conflictsResolved: 0, remaining: 0, errors: [], running: true });
    let renamed = 0;
    let conflictsResolved = 0;
    let errors: { code: string; message: string }[] = [];
    try {
      for (let i = 0; i < 40; i++) {
        const r = await applyCleanFn({ data: { limit: 150 } });
        renamed += r.renamed;
        conflictsResolved += r.conflictsResolved;
        errors = [...errors, ...r.errors].slice(0, 50);
        setCleanProgress({ renamed, conflictsResolved, remaining: r.remaining, errors, running: r.remaining > 0 });
        if (r.remaining === 0 || r.processed === 0) break;
      }
      toast.success(`${renamed} código(s) limpo(s) · ${errors.length} erro(s)`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro");
    } finally {
      setCleanProgress((p) => (p ? { ...p, running: false } : p));
      setUrls({});
      qc.invalidateQueries({ queryKey: ["all-pieces"] });
      previewCleanMut.mutate();
    }
  }



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
  const [syncReport, setSyncReport] = useState<{
    created: number;
    updated: number;
    removed: number;
    embeddingsCreated: number;
    embeddingsUpdated: number;
    embeddingsRemoved: number;
    errors: { code: string; message: string }[];
  } | null>(null);



  async function processFiles(files: File[]) {
    if (files.length === 0) return;
    setUploading(true);
    setProgress({ done: 0, total: files.length });
    const queue = files.map((f) => ({ name: f.name, status: "pending" as const }));
    setUploadQueue(queue);
    setSyncReport(null);

    // Várias fotos do mesmo produto: 1ª = CODE, demais = CODE_V2, CODE_V3...
    // todas associadas ao mesmo código de produto.
    const seen = new Map<string, number>();
    let created = 0;
    let updated = 0;
    const errs: { code: string; message: string }[] = [];

    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const productCode = codeFromFilename(f.name);
      const n = (seen.get(productCode) ?? 0) + 1;
      seen.set(productCode, n);
      const code = n === 1 ? productCode : `${productCode}_V${n}`;
      try {
        const dataUrl = await fileToDataUrl(f);
        const res = await addFn({
          data: { code, productCode, imageDataUrl: dataUrl, category: uploadCategory },
        });
        if (res?.action === "updated") updated++;
        else created++;
        setUploadQueue((prev) => {
          const c = [...prev];
          c[i] = { ...c[i], status: "ok" };
          return c;
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "erro";
        errs.push({ code, message });
        setUploadQueue((prev) => {
          const c = [...prev];
          c[i] = { ...c[i], status: "error", msg: message };
          return c;
        });
      }
      setProgress({ done: i + 1, total: files.length });
    }
    setUploading(false);
    setSyncReport({
      created,
      updated,
      removed: 0,
      embeddingsCreated: created,
      embeddingsUpdated: updated,
      embeddingsRemoved: 0,
      errors: errs,
    });
    qc.invalidateQueries({ queryKey: ["all-pieces"] });
    qc.invalidateQueries({ queryKey: ["pieces-count"] });
    qc.invalidateQueries({ queryKey: ["index-health"] });
    toast.success(
      `Sincronização: ${created} adicionada(s), ${updated} atualizada(s), ${errs.length} erro(s)`,
    );
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

      {/* Sincronização do índice de busca por imagem */}
      <section className="mb-8 rounded-xl border border-border bg-card/60 backdrop-blur p-5">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <RefreshCw className="h-5 w-5 text-[color:var(--gold)]" />
            <h2 className="serif text-xl gold-text">Índice de busca por imagem</h2>
            {health && (
              <span
                className={`ml-2 rounded-full text-xs px-2 py-0.5 ${
                  health.healthy
                    ? "bg-[color:var(--gold)]/20 text-[color:var(--gold)]"
                    : "bg-destructive/15 text-destructive"
                }`}
              >
                {health.healthy ? "Sincronizado" : `${health.missing} pendente(s)`}
              </span>
            )}
          </div>
          <button
            onClick={() => syncMut.mutate()}
            disabled={syncMut.isPending || uploading}
            className="flex items-center gap-2 rounded-lg border border-[color:var(--gold)]/40 px-4 py-2 text-xs font-medium hover:bg-[color:var(--gold)]/10 disabled:opacity-60"
          >
            {syncMut.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Sincronizar pendentes (incremental)
          </button>
        </div>
        {health && (
          <p className="mt-3 text-xs text-muted-foreground">
            {health.indexed} de {health.total} peça(s) indexadas na busca por imagem · sem embedding:{" "}
            {health.missing}
          </p>
        )}
        {syncReport && (
          <div className="mt-4 rounded-lg border border-border bg-background/50 p-4 text-xs space-y-1">
            <div className="font-semibold text-[color:var(--gold)] mb-1">Relatório de sincronização</div>
            <div>Produtos adicionados: {syncReport.created}</div>
            <div>Produtos atualizados: {syncReport.updated}</div>
            <div>Produtos removidos: {syncReport.removed}</div>
            <div>Embeddings criados: {syncReport.embeddingsCreated}</div>
            <div>Embeddings atualizados: {syncReport.embeddingsUpdated}</div>
            <div>Embeddings removidos: {syncReport.embeddingsRemoved}</div>
            <div>Erros encontrados: {syncReport.errors.length}</div>
            {syncReport.errors.length > 0 && (
              <ul className="mt-1 max-h-32 overflow-auto text-destructive">
                {syncReport.errors.map((e, i) => (
                  <li key={`${e.code}-${i}`}>
                    {e.code}: {e.message}
                  </li>
                ))}
              </ul>
            )}
            <div className="pt-1">
              Status:{" "}
              <span className={syncReport.errors.length === 0 ? "text-[color:var(--gold)]" : "text-destructive"}>
                {syncReport.errors.length === 0 ? "Sincronizado com sucesso" : "Concluído com pendências"}
              </span>
            </div>
          </div>
        )}
      </section>

      {/* Limpeza de peso/valor no código */}
      <section className="mb-8 rounded-xl border border-border bg-card/60 backdrop-blur p-5">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <Eraser className="h-5 w-5 text-[color:var(--gold)]" />
            <h2 className="serif text-xl gold-text">Limpar peso do código</h2>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => previewCleanMut.mutate()}
              disabled={previewCleanMut.isPending || cleanProgress?.running}
              className="flex items-center gap-2 rounded-lg border border-[color:var(--gold)]/40 px-4 py-2 text-xs font-medium hover:bg-[color:var(--gold)]/10 disabled:opacity-60"
            >
              {previewCleanMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Pré-visualizar
            </button>
            <button
              onClick={() => runCleanup()}
              disabled={!cleanPreview || cleanPreview.affected === 0 || cleanProgress?.running}
              className="flex items-center gap-2 rounded-lg gold-gradient px-4 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-60 hover:brightness-110 transition"
            >
              {cleanProgress?.running ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Aplicar
            </button>
          </div>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Remove do código apenas o peso/valor no final (ex.: PGD00622_-_(4,85) → PGD00622). Sufixos
          como (2), (6MM) ou (ADEMAR) são preservados. Os embeddings não são afetados.
        </p>
        {cleanPreview && (
          <div className="mt-4 rounded-lg border border-border bg-background/50 p-4 text-xs space-y-1">
            <div className="font-semibold text-[color:var(--gold)] mb-1">Pré-visualização</div>
            <div>Peças no catálogo: {cleanPreview.total}</div>
            <div>Peças a renomear: {cleanPreview.affected}</div>
            <div>Conflitos de código (vira foto adicional do produto): {cleanPreview.conflicts}</div>
            {cleanPreview.sample.length > 0 && (
              <ul className="mt-2 max-h-40 overflow-auto space-y-0.5">
                {cleanPreview.sample.map((s) => (
                  <li key={s.from} className="text-muted-foreground">
                    {s.from} <span className="text-[color:var(--gold)]">→</span> {s.to}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {cleanProgress && (
          <div className="mt-4 rounded-lg border border-border bg-background/50 p-4 text-xs space-y-1">
            <div className="font-semibold text-[color:var(--gold)] mb-1">Relatório da limpeza</div>
            <div>Códigos limpos: {cleanProgress.renamed}</div>
            <div>Conflitos resolvidos: {cleanProgress.conflictsResolved}</div>
            <div>Restantes: {cleanProgress.remaining}</div>
            <div>Erros: {cleanProgress.errors.length}</div>
            {cleanProgress.errors.length > 0 && (
              <ul className="mt-1 max-h-32 overflow-auto text-destructive">
                {cleanProgress.errors.map((e, i) => (
                  <li key={`${e.code}-${i}`}>
                    {e.code}: {e.message}
                  </li>
                ))}
              </ul>
            )}
            <div className="pt-1">
              Status:{" "}
              <span className={cleanProgress.running ? "text-muted-foreground" : "text-[color:var(--gold)]"}>
                {cleanProgress.running ? "Em andamento…" : "Concluído"}
              </span>
            </div>
          </div>
        )}
      </section>



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
                <div className="absolute top-1.5 right-1.5 flex gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition">
                  <button
                    title="Renomear peça"
                    aria-label={`Renomear peça ${p.code}`}
                    onClick={() => openRename(p)}
                    className="rounded-full bg-background/80 backdrop-blur p-1.5 hover:bg-[color:var(--gold)]/30 transition"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    title="Remover peça"
                    aria-label={`Remover peça ${p.code}`}
                    onClick={() => {
                      if (confirm(`Remover peça ${p.code}?`)) del.mutate(p.id);
                    }}
                    className="rounded-full bg-background/80 backdrop-blur p-1.5 hover:bg-destructive transition"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
              <div className="p-2 text-center text-xs font-medium tracking-wide truncate">{p.code}</div>
              {p.name && (
                <div className="px-2 pb-2 text-center text-[11px] text-muted-foreground truncate">
                  {p.name}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {renaming && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4"
          onClick={() => !renameMut.isPending && setRenaming(null)}
        >
          <div
            className="w-full max-w-sm rounded-xl border border-[color:var(--gold)]/30 bg-card p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="serif text-xl gold-text mb-1">Renomear peça</h3>
            <p className="text-xs text-muted-foreground mb-4">
              O código atual é <span className="font-medium">{renaming.code}</span>. A imagem e o
              índice de busca são preservados.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const code = renameCode.trim().toUpperCase();
                if (!code) {
                  toast.error("Informe o código da peça.");
                  return;
                }
                renameMut.mutate({
                  id: renaming.id,
                  code,
                  name: renameName.trim() || undefined,
                });
              }}
              className="space-y-3"
            >
              <label className="block text-xs">
                <span className="text-muted-foreground">Código</span>
                <input
                  autoFocus
                  value={renameCode}
                  onChange={(e) => setRenameCode(e.target.value)}
                  className="mt-1 w-full rounded-lg bg-background border border-[color:var(--gold)]/30 px-3 py-2 text-sm uppercase focus:outline-none focus:border-[color:var(--gold)]"
                />
              </label>
              <label className="block text-xs">
                <span className="text-muted-foreground">Nome (opcional)</span>
                <input
                  value={renameName}
                  onChange={(e) => setRenameName(e.target.value)}
                  placeholder="Ex.: Pingente coração cravejado"
                  className="mt-1 w-full rounded-lg bg-background border border-[color:var(--gold)]/30 px-3 py-2 text-sm focus:outline-none focus:border-[color:var(--gold)]"
                />
              </label>
              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setRenaming(null)}
                  disabled={renameMut.isPending}
                  className="rounded-lg border border-border px-4 py-2 text-xs text-muted-foreground hover:text-foreground disabled:opacity-60"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={renameMut.isPending}
                  className="flex items-center gap-2 rounded-lg gold-gradient px-4 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-60"
                >
                  {renameMut.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Salvar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>

  );
}
