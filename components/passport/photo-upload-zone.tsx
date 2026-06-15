"use client";

import { Upload, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { cn } from "@/lib/utils";

type PhotoUploadZoneProps = {
  photos: File[];
  onAdd: (files: File[]) => void;
  onRemove: (index: number) => void;
  maxPhotos: number;
  error?: string;
  disabled?: boolean;
};

export function PhotoUploadZone({
  photos,
  onAdd,
  onRemove,
  maxPhotos,
  error,
  disabled,
}: PhotoUploadZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [dropError, setDropError] = useState<string | null>(null);

  const previewUrls = useMemo(
    () => photos.map((file) => URL.createObjectURL(file)),
    [photos],
  );

  useEffect(() => {
    return () => {
      for (const url of previewUrls) URL.revokeObjectURL(url);
    };
  }, [previewUrls]);

  const canAddMore = photos.length < maxPhotos;

  const handleFiles = useCallback(
    (fileList: FileList | File[]) => {
      const incoming = Array.from(fileList);
      const images = incoming.filter((f) => f.type.startsWith("image/"));
      const rejected = incoming.length - images.length;

      if (rejected > 0) {
        setDropError("Only image files are supported.");
      } else {
        setDropError(null);
      }

      if (images.length === 0) return;

      const remaining = maxPhotos - photos.length;
      if (remaining <= 0) return;

      onAdd(images.slice(0, remaining));
      if (inputRef.current) inputRef.current.value = "";
    },
    [maxPhotos, onAdd, photos.length],
  );

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (!disabled && canAddMore) setDragOver(true);
  };

  const onDragLeave = () => {
    setDragOver(false);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (disabled || !canAddMore) return;
    if (e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files);
    }
  };

  const displayError = error ?? dropError;

  return (
    <div>
      {canAddMore && (
        <div
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
        >
          <input
            ref={inputRef}
            type="file"
            multiple
            accept="image/*"
            id="passport-photos"
            className="sr-only"
            disabled={disabled}
            onChange={(e) => {
              if (e.target.files) handleFiles(e.target.files);
            }}
          />
          <label
            htmlFor="passport-photos"
            className={cn(
              "block cursor-pointer rounded-md border-2 border-dashed p-8 text-center transition-colors duration-200",
              dragOver
                ? "border-accent-warm bg-bg-card"
                : "border-border-default bg-bg-surface hover:border-border-hover",
              disabled && "cursor-not-allowed opacity-50",
            )}
          >
            <Upload
              size={32}
              strokeWidth={1.5}
              className="mx-auto mb-3 text-text-tertiary"
              aria-hidden
            />
            <p className="font-sans text-sm text-text-secondary">
              Drag photos here or click to upload
            </p>
            <p className="mt-1 font-mono text-xs text-text-tertiary">
              JPEG, PNG, WebP · Up to {maxPhotos} photos
            </p>
          </label>
        </div>
      )}

      {photos.length > 0 && (
        <div className={cn("grid grid-cols-2 gap-3 sm:grid-cols-3", canAddMore && "mt-4")}>
          {photos.map((file, index) => (
            <div
              key={`${file.name}-${index}`}
              className="relative aspect-square overflow-hidden rounded-md border border-border-default bg-bg-surface"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={previewUrls[index]}
                alt={file.name}
                className="h-full w-full object-cover"
              />
              {!disabled && (
                <button
                  type="button"
                  className="absolute right-1.5 top-1.5 rounded-sm bg-bg-primary/80 p-1 transition-colors hover:bg-bg-primary"
                  onClick={() => onRemove(index)}
                  aria-label="Remove photo"
                >
                  <X size={14} strokeWidth={2} aria-hidden />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {!canAddMore && (
        <p className="mt-2 font-mono text-xs text-text-secondary">
          {maxPhotos}/{maxPhotos} photos added
        </p>
      )}

      {displayError && (
        <p className="mt-2 font-sans text-sm text-status-error" role="alert">
          {displayError}
        </p>
      )}
    </div>
  );
}
