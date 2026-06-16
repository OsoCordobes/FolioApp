"use client";

import { useCallback, useId, useRef, useState } from "react";

import { PHOTO_ALLOWED_MIME, validatePhotoFile } from "@/lib/storage/professional-photos";

/**
 * Folio · <PhotoUpload> (M62)
 *
 * Drag-drop + click uploader de la foto pública del profesional. Clon de
 * <LogoUpload> (mismo state machine + a11y + reduce-motion vía folio.css) con
 * preview REDONDO (headshot) y MIME JPG/PNG/WebP. Upload/remove inyectables
 * para dev/tests; por defecto pegan a las server actions de perfil público.
 */

export interface PhotoUploadProps {
  currentPhotoUrl?: string | null;
  onUploaded: (fotoUrl: string) => void;
  onRemoved: () => void;
  uploadAction?: (formData: FormData) => Promise<{ ok: boolean; error?: string; fotoUrl?: string }>;
  removeAction?: () => Promise<{ ok: boolean; error?: string }>;
}

type Status = "idle" | "drag-over" | "uploading" | "error";

async function defaultUpload(formData: FormData) {
  const { uploadProfessionalPhoto } = await import(
    "@/app/(app)/configuracion/perfil-publico-actions"
  );
  return uploadProfessionalPhoto(formData);
}

async function defaultRemove() {
  const { removeProfessionalPhoto } = await import(
    "@/app/(app)/configuracion/perfil-publico-actions"
  );
  return removeProfessionalPhoto();
}

export function PhotoUpload({
  currentPhotoUrl,
  onUploaded,
  onRemoved,
  uploadAction = defaultUpload,
  removeAction = defaultRemove,
}: PhotoUploadProps) {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [localPreview, setLocalPreview] = useState<string | null>(currentPhotoUrl ?? null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();

  const handleFile = useCallback(
    async (file: File) => {
      setError(null);
      const v = validatePhotoFile(file);
      if (!v.ok) {
        setStatus("error");
        setError(v.error);
        return;
      }
      const reader = new FileReader();
      reader.onload = async () => {
        setLocalPreview(reader.result as string);
        setStatus("uploading");
        const fd = new FormData();
        fd.append("file", file);
        const result = await uploadAction(fd);
        if (!result.ok || !result.fotoUrl) {
          setStatus("error");
          setError(result.error ?? "Error desconocido al subir la foto.");
          setLocalPreview(currentPhotoUrl ?? null);
          return;
        }
        setStatus("idle");
        setLocalPreview(result.fotoUrl);
        onUploaded(result.fotoUrl);
      };
      reader.readAsDataURL(file);
    },
    [uploadAction, onUploaded, currentPhotoUrl],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setStatus("idle");
      const file = e.dataTransfer.files?.[0];
      if (file) void handleFile(file);
    },
    [handleFile],
  );

  const onClickPick = () => fileInputRef.current?.click();

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) void handleFile(f);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const onRemove = async () => {
    setError(null);
    const r = await removeAction();
    if (!r.ok) {
      setError(r.error ?? "No pude quitar la foto.");
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
      aria-label="Subir foto del profesional"
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
      onDragLeave={() => setStatus("idle")}
      onDrop={onDrop}
    >
      <input
        id={inputId}
        ref={fileInputRef}
        type="file"
        accept={PHOTO_ALLOWED_MIME.join(",")}
        hidden
        onChange={onPick}
      />

      {showPreview ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={localPreview!}
          alt="Vista previa de la foto"
          className="fpc-dropzone-preview fpc-dropzone-preview--round"
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
          <circle cx="12" cy="8" r="4" />
          <path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1" />
        </svg>
      )}

      <div style={{ textAlign: "center" }}>
        <div className="fpc-dropzone-headline">
          {showPreview
            ? status === "uploading"
              ? "Subiendo…"
              : "Cambiar foto"
            : status === "drag-over"
              ? "Soltá para subir"
              : "Arrastrá tu foto aquí o hacé click"}
        </div>
        <div className="fpc-dropzone-hint" id={`${inputId}-hint`}>
          JPG, PNG o WebP — máximo 500 KB
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
          Quitar foto
        </button>
      ) : null}
    </div>
  );
}
