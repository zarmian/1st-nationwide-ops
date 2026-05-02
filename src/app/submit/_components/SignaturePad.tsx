"use client";

import { useEffect, useRef, useState } from "react";
import { upload } from "@vercel/blob/client";

export function SignaturePad({
  value,
  onChange,
  siteId,
}: {
  value: string | null | undefined;
  onChange: (url: string | null) => void;
  siteId: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const lastPtRef = useRef<{ x: number; y: number } | null>(null);
  const dirtyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Resize the canvas to its CSS box and set up a clean drawing context.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#0F1929";
  }, []);

  function getPos(e: PointerEvent | React.PointerEvent): { x: number; y: number } {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function start(e: React.PointerEvent<HTMLCanvasElement>) {
    e.preventDefault();
    canvasRef.current?.setPointerCapture(e.pointerId);
    drawingRef.current = true;
    lastPtRef.current = getPos(e);
  }

  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    e.preventDefault();
    const ctx = canvasRef.current?.getContext("2d");
    const last = lastPtRef.current;
    if (!ctx || !last) return;
    const p = getPos(e);
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    lastPtRef.current = p;
    dirtyRef.current = true;
  }

  function end(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    lastPtRef.current = null;
    canvasRef.current?.releasePointerCapture(e.pointerId);
  }

  function clear() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    ctx?.clearRect(0, 0, canvas.width, canvas.height);
    dirtyRef.current = false;
    onChange(null);
    setError(null);
  }

  async function save() {
    if (busy) return;
    const canvas = canvasRef.current;
    if (!canvas || !dirtyRef.current) {
      setError("Draw your signature first.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const blob: Blob | null = await new Promise((resolve) =>
        canvas.toBlob((b) => resolve(b), "image/png"),
      );
      if (!blob) throw new Error("Could not capture signature");
      const file = new File([blob], `signature-${Date.now()}.png`, {
        type: "image/png",
      });
      const result = await upload(`uploads/signatures/${file.name}`, file, {
        access: "public",
        handleUploadUrl: "/api/blob/upload-token",
        clientPayload: JSON.stringify({ siteId }),
      });
      onChange(result.url);
    } catch (err: any) {
      setError(err?.message ?? "Could not upload signature");
    } finally {
      setBusy(false);
    }
  }

  if (value) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-2">
        <img
          src={value}
          alt="Signature"
          className="max-h-32 mx-auto"
        />
        <button
          type="button"
          onClick={() => {
            clear();
          }}
          className="btn-secondary text-sm w-full"
        >
          Re-sign
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-2">
      <canvas
        ref={canvasRef}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        className="w-full h-40 border border-dashed border-slate-300 rounded-lg touch-none bg-slate-50/40"
      />
      <div className="flex gap-2">
        <button
          type="button"
          onClick={clear}
          className="btn-secondary text-sm flex-1"
          disabled={busy}
        >
          Clear
        </button>
        <button
          type="button"
          onClick={save}
          className="btn-primary text-sm flex-1"
          disabled={busy}
        >
          {busy ? "Saving…" : "Save signature"}
        </button>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
