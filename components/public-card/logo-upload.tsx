"use client";

import { useCallback, useId, useRef, useState } from "react";

import {
  LOGO_ALLOWED_MIME,
  validateLogoFile,
} from "@/lib/storage/logos";

/**
 * Folio · <LogoUpload>
 *
 * Drag-drop + click-to-browse PNG uploader with a 5-state machine:
 *   idle | idle-with-logo | drag-over | uploading | error
 *
 * Motion (consumes the named beats declared in design-language doc §3.5):
 *   - fpc-logo-drop-enter  → stamp-in of the preview (320 ms, --ease-overshoot)
 *   - fpc-logo-drop-error  → 3-cycle shake (220 ms, --ease-anticipate)
 *
 * Upload + remove are passed as props so:
 *   (a) Step 4 wires the real server actions (uploadOrgLogo / removeOrgLogo).
 *   (b) The dev preview at /dev/logo-upload + Playwright tests inject mocks
 *       without needing an authenticated session.
 *
 * Reduce-motion compliance lives in folio.css (animations stripped to
 * final-state-only under prefers-reduced-motion: reduce).
 */

export interface LogoUploadProps {
  /** Current persisted logo URL — when set, the preview renders this image. */
  currentLogoUrl?: string | null;
  /** Called with the new URL after successful upload. */
  onUploaded: (logoUrl: string) => void;
  /** Called after a successful remove. */
  onRemoved: () => void;
  /**
   * Performs the upload. Default uses the production server action.
   * Override for dev preview / tests.
   */
  uploadAction?: (formData: FormData) => Promise<{ ok: boolean; error?: string; logoUrl?: string }>;
  /**
   * Performs the remove. Default uses the production server action.
   * Override for dev preview / tests.
   */
  removeAction?: () => Promise<{ ok: boolean; error?: string }>;
}

type Status = "idle" | "drag-over" | "uploading" | "error";

async function defaultUpload(formData: FormData) {
  const { uploadOrgLogo } = await import("@/app/(public)/onboarding/actions");
  return uploadOrgLogo(formData);
}

async function defaultRemove() {
  const { removeOrgLogo } = await import("@/app/(public)/onboarding/actions");
  return removeOrgLogo();
}

export function LogoUpload({
  currentLogoUrl,
  onUploaded,
  onRemoved,
  uploadAction = defaultUpload,
  removeAction = defaultRemove,
}: LogoUploadProps) {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [localPreview, setLocalPreview] = useState<string | null>(currentLogoUrl ?? null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();

  const handleFile = useCallback(
    async (file: File) => {
      setError(null);

      const v = validateLogoFile(file);
      if (!v.ok) {
        setStatus("error");
        setError(v.error);
        return;
      }

      // Optimistic local preview while the upload runs.
      const reader = new FileReader();
      reader.onload = async () => {
        const dataUrl = reader.result as string;
        setLocalPreview(dataUrl);
        setStatus("uploading");

        const fd = new FormData();
        fd.append("file", file);
        const result = await uploadAction(fd);

        if (!result.ok || !result.logoUrl) {
          setStatus("error");
          setError(result.error ?? "Error desconocido al subir el logo.");
          setLocalPreview(currentLogoUrl ?? null);
          return;
        }
        setStatus("idle");
        setLocalPreview(result.logoUrl);
        onUploaded(result.logoUrl);
      };
      reader.readAsDataURL(file);
    },
    [uploadAction, onUploaded, currentLogoUrl],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setStatus("idle");
      const file = e.dataTransfer.files?.[0];
      if (!file) return;
      void handleFile(file);
    },
    [handleFile],
  );

  const onClickPick = () => fileInputRef.current?.click();

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) void handleFile(f);
    // reset value so picking the same file twice still fires onChange
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const onRemove = async () => {
    setError(null);
    const r = await removeAction();
    if (!r.ok) {
      setError(r.error ?? "No pude quitar el logo.");
      return;
    }
    setLocalPreview(null);
    setStatus("idle");
    onRemoved();
  };

  const dragClass =
    status === "drag-over" ? "is-drag-over" : status === "error" ? "is-error" : "";

  const showPreview = !!localPreview;

  return (
    <div
      className={`fpc-dropzone ${dragClass}`.trim()}
      role="button"
      aria-label="Subir logo del consultorio"
      aria-describedby={`${inputId}-hint`}
      tabIndex={0}
      data-status={status}
      onClick={onClickPick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClickPick();
        }
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setStatus("drag-over");
      }}
      onDragLeave={() => setStatus(showPreview ? "idle" : "idle")}
      onDrop={onDrop}
    >
      <input
        id={inputId}
        ref={fileInputRef}
        type="file"
        accept={LOGO_ALLOWED_MIME.join(",")}
        hidden
        onChange={onPick}
      />

      {showPreview ? (
        // The preview is a transient data URL (during upload) or a Supabase
        // public URL (after upload). next/image's static optimization adds no
        // value here and breaks on data URLs without unoptimized config.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={localPreview!}
          alt="Vista previa del logo"
          className="fpc-dropzone-preview"
          width={80}
          height={80}
        />
      ) : (
        <svg
          width="36"
          height="36"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          aria-hidden
          style={{ color: "var(--ink-4)" }}
        >
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="17 8 12 3 7 8" />
          <line x1="12" y1="3" x2="12" y2="15" />
        </svg>
      )}

      <div style={{ textAlign: "center" }}>
        <div className="fpc-dropzone-headline">
          {showPreview
            ? status === "uploading"
              ? "Subiendo…"
              : "Cambiar logo"
            : status === "drag-over"
              ? "Soltá para subir"
              : "Arrastrá tu logo aquí o hacé click"}
        </div>
        <div className="fpc-dropzone-hint" id={`${inputId}-hint`}>
          PNG, fondo transparente, ≥ 512×512 — máximo 500 KB
        </div>
      </div>

      {error ? (
        <div role="alert" className="fpc-dropzone-error">
          {error}
        </div>
      ) : null}

      {showPreview ? (
        <button
          type="button"
          className="fpc-dropzone-remove"
          onClick={(e) => {
            e.stopPropagation();
            void onRemove();
          }}
        >
          Quitar logo
        </button>
      ) : null}
    </div>
  );
}
