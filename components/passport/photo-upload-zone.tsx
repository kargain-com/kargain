"use client";

import { Upload } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { PhotoThumbGrid } from "@/components/passport/photo-thumb-grid";
import { isHeicFile } from "@/lib/passport/compress-passport-image";
import { passportImageOptimizeErrorMessage } from "@/lib/passport/passport-flow-messages";
import { processPassportPhotoFiles } from "@/lib/passport/process-passport-photo-files";
import { cn } from "@/lib/utils";

type PhotoUploadZoneProps = {
  photos: File[];
  onAdd: (files: File[]) => void;
  onRemove: (index: number) => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
  maxPhotos: number;
  error?: string;
  disabled?: boolean;
};

function isAcceptedImage(file: File): boolean {
  if (file.type.startsWith("image/")) return true;
  return isHeicFile(file);
}

export function PhotoUploadZone({
  photos,
  onAdd,
  onRemove,
  onReorder,
  maxPhotos,
  error,
  disabled,
}: PhotoUploadZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [dropError, setDropError] = useState<string | null>(null);
  const [isOptimizing, setIsOptimizing] = useState(false);

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
  const zoneDisabled = disabled || isOptimizing;

  const handleFiles = useCallback(
    (fileList: FileList | File[]) => {
      const incoming = Array.from(fileList);
      const images = incoming.filter(isAcceptedImage);
      const rejected = incoming.length - images.length;

      if (rejected > 0) {
        setDropError("Only image files are supported.");
      } else {
        setDropError(null);
      }

      if (images.length === 0) return;

      const remaining = maxPhotos - photos.length;
      if (remaining <= 0) return;

      const batch = images.slice(0, remaining);
      setIsOptimizing(true);

      void processPassportPhotoFiles(batch)
        .then((optimized) => {
          onAdd(optimized);
        })
        .catch((err) => {
          setDropError(passportImageOptimizeErrorMessage(err));
        })
        .finally(() => {
          setIsOptimizing(false);
          if (inputRef.current) inputRef.current.value = "";
        });
    },
    [maxPhotos, onAdd, photos.length],
  );

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (!zoneDisabled && canAddMore) setDragOver(true);
  };

  const onDragLeave = () => {
    setDragOver(false);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (zoneDisabled || !canAddMore) return;
    if (e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files);
    }
  };

  const displayError = error ?? dropError;

  return (
    <div>
      {canAddMore && (
        <div onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept="image/*,.heic,.heif"
            id="passport-photos"
            className="sr-only"
            disabled={zoneDisabled}
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
              zoneDisabled && "cursor-not-allowed opacity-50",
            )}
          >
            <Upload
              size={32}
              strokeWidth={1.5}
              className="mx-auto mb-3 text-text-tertiary"
              aria-hidden
            />
            <p className="font-sans text-sm text-text-secondary">
              {isOptimizing ? "Optimizing photos…" : "Drag photos here or click to upload"}
            </p>
            <p className="mt-1 font-mono text-xs text-text-tertiary">
              JPEG, PNG, WebP, HEIC · optimized to WebP (up to 100 KB each) · up to {maxPhotos} photos
            </p>
          </label>
        </div>
      )}

      {photos.length > 0 && (
        <div className={canAddMore ? "mt-4 space-y-2" : "space-y-2"}>
          <p className="font-mono text-xs text-text-tertiary">
            First photo is the cover. Use arrows to reorder.
          </p>
          <PhotoThumbGrid
            items={photos.map((file, index) => ({
              id: `${file.name}-${file.size}-${file.lastModified}-${index}`,
              src: previewUrls[index]!,
              alt: file.name,
            }))}
            disabled={zoneDisabled}
            onRemove={onRemove}
            onReorder={onReorder}
          />
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
