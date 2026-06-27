"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { upload } from "@vercel/blob/client";

/**
 * Live in-page camera capture. Uses getUserMedia so the photo can ONLY be
 * taken with the device camera right now — there is no file picker, so an
 * officer can't upload an old gallery image for a check-in.
 *
 * On capture: draws the current video frame to a canvas, encodes a JPEG,
 * uploads it to Vercel Blob via the same anonymous token endpoint the
 * /submit flow uses, and reports the public URL back.
 */
export function CameraCapture({
  siteId,
  onCaptured,
  disabled,
}: {
  siteId: string;
  onCaptured: (url: string | null) => void;
  disabled?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [phase, setPhase] = useState<"idle" | "live" | "uploading" | "done">(
    "idle",
  );
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => stop, [stop]);

  async function openCamera() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      setPhase("live");
    } catch {
      setError(
        "Couldn't open the camera. Allow camera access in your browser and try again.",
      );
    }
  }

  async function capture() {
    const video = videoRef.current;
    if (!video) return;
    const w = video.videoWidth || 1280;
    const h = video.videoHeight || 720;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      setError("Couldn't capture the photo. Try again.");
      return;
    }
    ctx.drawImage(video, 0, 0, w, h);

    const blob: Blob | null = await new Promise((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/jpeg", 0.85),
    );
    stop();
    if (!blob) {
      setError("Couldn't encode the photo. Try again.");
      setPhase("idle");
      return;
    }

    setPhase("uploading");
    try {
      const file = new File([blob], `checkin-${Date.now()}.jpg`, {
        type: "image/jpeg",
      });
      const result = await upload(`uploads/checkins/${file.name}`, file, {
        access: "public",
        handleUploadUrl: "/api/blob/upload-token",
        clientPayload: JSON.stringify({ siteId }),
      });
      setPreviewUrl(result.url);
      setPhase("done");
      onCaptured(result.url);
    } catch (err: any) {
      setError(err?.message ?? "Upload failed. Try again.");
      setPhase("idle");
      onCaptured(null);
    }
  }

  function retake() {
    setPreviewUrl(null);
    onCaptured(null);
    void openCamera();
  }

  return (
    <div className="space-y-2">
      {phase === "idle" && (
        <button
          type="button"
          onClick={openCamera}
          disabled={disabled}
          className="btn-secondary w-full"
        >
          Open camera
        </button>
      )}

      {phase === "live" && (
        <div className="space-y-2">
          <video
            ref={videoRef}
            playsInline
            muted
            className="w-full rounded-lg bg-black aspect-[3/4] object-cover"
          />
          <button
            type="button"
            onClick={capture}
            className="btn-primary w-full"
          >
            Take photo
          </button>
        </div>
      )}

      {phase === "uploading" && (
        <p className="text-sm text-slate-600 text-center py-3">
          Uploading photo…
        </p>
      )}

      {phase === "done" && previewUrl && (
        <div className="space-y-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={previewUrl}
            alt="Check-in photo"
            className="w-full rounded-lg border border-slate-200"
          />
          <button
            type="button"
            onClick={retake}
            disabled={disabled}
            className="btn-secondary w-full text-sm"
          >
            Retake
          </button>
        </div>
      )}

      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
