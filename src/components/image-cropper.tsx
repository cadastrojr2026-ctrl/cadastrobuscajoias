import { useEffect, useRef, useState } from "react";
import { Crop, Search, X } from "lucide-react";

type Rect = { x: number; y: number; w: number; h: number };
type Mode = "move" | "nw" | "ne" | "sw" | "se";

const MIN = 0.08;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/**
 * Recorte da foto de consulta, antes da busca. Roda no navegador.
 * O recorte isola a peça (sem fundo, reflexos e correntes ao redor), deixando a
 * foto mais parecida com a do catálogo.
 */
export function ImageCropper({
  file,
  onConfirm,
  onCancel,
}: {
  file: File;
  onConfirm: (file: File) => void;
  onCancel: () => void;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [rect, setRect] = useState<Rect>({ x: 0.15, y: 0.15, w: 0.7, h: 0.7 });
  const boxRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const touched = useRef(false);
  const drag = useRef<{ mode: Mode; px: number; py: number; start: Rect } | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    setSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function begin(e: React.PointerEvent, mode: Mode) {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    touched.current = true;
    drag.current = { mode, px: e.clientX, py: e.clientY, start: rect };
  }

  function move(e: React.PointerEvent) {
    const d = drag.current;
    const box = boxRef.current;
    if (!d || !box) return;
    const b = box.getBoundingClientRect();
    const dx = (e.clientX - d.px) / b.width;
    const dy = (e.clientY - d.py) / b.height;
    const s = d.start;
    if (d.mode === "move") {
      setRect({
        ...s,
        x: clamp(s.x + dx, 0, 1 - s.w),
        y: clamp(s.y + dy, 0, 1 - s.h),
      });
      return;
    }
    let left = s.x;
    let top = s.y;
    let right = s.x + s.w;
    let bottom = s.y + s.h;
    if (d.mode === "nw" || d.mode === "sw") left = clamp(s.x + dx, 0, right - MIN);
    if (d.mode === "ne" || d.mode === "se") right = clamp(s.x + s.w + dx, left + MIN, 1);
    if (d.mode === "nw" || d.mode === "ne") top = clamp(s.y + dy, 0, bottom - MIN);
    if (d.mode === "sw" || d.mode === "se") bottom = clamp(s.y + s.h + dy, top + MIN, 1);
    setRect({ x: left, y: top, w: right - left, h: bottom - top });
  }

  function end() {
    drag.current = null;
  }

  function confirm() {
    const img = imgRef.current;
    if (!img) return;
    const nw = img.naturalWidth;
    const nh = img.naturalHeight;
    const sx = Math.round(rect.x * nw);
    const sy = Math.round(rect.y * nh);
    const sw = Math.max(1, Math.round(rect.w * nw));
    const sh = Math.max(1, Math.round(rect.h * nh));
    // Moldura nunca movida: usa a foto inteira (o recorte padrão de 70% central
    // cortaria a peça sem o usuário ter pedido).
    if (!touched.current) {
      onConfirm(file);
      return;
    }
    // O modelo reduz e corta o CENTRO quadrado da imagem; um recorte retangular
    // perderia as pontas da peça. Entrega um quadrado, com a peça inteira,
    // completando as laterais com a cor média do recorte.
    const side = Math.max(sw, sh);
    const canvas = document.createElement("canvas");
    canvas.width = side;
    canvas.height = side;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      onConfirm(file);
      return;
    }
    const probe = document.createElement("canvas");
    probe.width = 1;
    probe.height = 1;
    const pctx = probe.getContext("2d");
    if (pctx) {
      pctx.drawImage(img, sx, sy, sw, sh, 0, 0, 1, 1);
      const [r, g, b] = pctx.getImageData(0, 0, 1, 1).data;
      ctx.fillStyle = `rgb(${r},${g},${b})`;
    } else {
      ctx.fillStyle = "#ffffff";
    }
    ctx.fillRect(0, 0, side, side);
    ctx.drawImage(img, sx, sy, sw, sh, Math.round((side - sw) / 2), Math.round((side - sh) / 2), sw, sh);
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          onConfirm(file);
          return;
        }
        onConfirm(new File([blob], "recorte.jpg", { type: "image/jpeg" }));
      },
      "image/jpeg",
      0.92,
    );
  }

  const pct = (n: number) => `${n * 100}%`;
  const handle =
    "absolute h-6 w-6 rounded-full border-2 border-[color:var(--gold)] bg-background touch-none";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/90 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-lg rounded-xl border border-[color:var(--gold)]/30 bg-card p-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="serif text-lg gold-text flex items-center gap-2">
            <Crop className="h-4 w-4" /> Recorte a peça
          </h3>
          <button
            onClick={onCancel}
            aria-label="Cancelar"
            className="rounded-full p-1 hover:bg-muted"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="text-xs text-muted-foreground mb-3">
          Arraste a moldura e os cantos para deixar só a peça. Menos fundo, reflexo e corrente ao
          redor melhora a busca.
        </p>

        <div className="flex justify-center">
          <div
            ref={boxRef}
            className="relative inline-block select-none touch-none"
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={end}
          >
            {src && (
              <img
                ref={imgRef}
                src={src}
                alt="Foto para recorte"
                draggable={false}
                className="block max-h-[55vh] max-w-full rounded-md"
              />
            )}
            {/* moldura: a sombra escurece o que fica de fora, mas só dentro da
                foto (overflow-hidden) — antes cobria a tela toda, inclusive os botões */}
            <div className="absolute inset-0 overflow-hidden rounded-md pointer-events-none">
              <div
                onPointerDown={(e) => begin(e, "move")}
                className="absolute cursor-move border-2 border-[color:var(--gold)] touch-none pointer-events-auto"
                style={{
                  left: pct(rect.x),
                  top: pct(rect.y),
                  width: pct(rect.w),
                  height: pct(rect.h),
                  boxShadow: "0 0 0 9999px rgba(0,0,0,0.55)",
                }}
              />
            </div>
            <div
              className={`${handle} cursor-nwse-resize`}
              style={{ left: pct(rect.x), top: pct(rect.y), transform: "translate(-50%,-50%)" }}
              onPointerDown={(e) => begin(e, "nw")}
            />
            <div
              className={`${handle} cursor-nesw-resize`}
              style={{
                left: pct(rect.x + rect.w),
                top: pct(rect.y),
                transform: "translate(-50%,-50%)",
              }}
              onPointerDown={(e) => begin(e, "ne")}
            />
            <div
              className={`${handle} cursor-nesw-resize`}
              style={{
                left: pct(rect.x),
                top: pct(rect.y + rect.h),
                transform: "translate(-50%,-50%)",
              }}
              onPointerDown={(e) => begin(e, "sw")}
            />
            <div
              className={`${handle} cursor-nwse-resize`}
              style={{
                left: pct(rect.x + rect.w),
                top: pct(rect.y + rect.h),
                transform: "translate(-50%,-50%)",
              }}
              onPointerDown={(e) => begin(e, "se")}
            />
          </div>
        </div>

        <div className="relative z-10 mt-4 grid grid-cols-2 gap-2 sm:flex sm:justify-end">
          <button
            onClick={onCancel}
            className="col-span-2 rounded-lg border border-border px-4 py-3 text-sm text-foreground/80 hover:text-foreground sm:col-span-1 sm:py-2 sm:text-xs"
          >
            Cancelar
          </button>
          <button
            onClick={() => onConfirm(file)}
            className="rounded-lg border-2 border-[color:var(--gold)] px-4 py-3 text-sm font-semibold text-foreground hover:bg-[color:var(--gold)]/10 sm:py-2 sm:text-xs"
          >
            Usar foto inteira
          </button>
          <button
            onClick={confirm}
            className="flex items-center justify-center gap-2 rounded-lg gold-gradient px-4 py-3 text-sm font-semibold text-primary-foreground shadow-md shadow-black/30 sm:py-2 sm:text-xs"
          >
            <Search className="h-3.5 w-3.5" /> Buscar com recorte
          </button>
        </div>
      </div>
    </div>
  );
}
