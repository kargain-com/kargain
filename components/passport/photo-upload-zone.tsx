"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { PhotoDropZone } from "@/components/passport/photo-drop-zone";
import { PhotoThumbGrid } from "@/components/passport/photo-thumb-grid";
import { isHeicFile } from "@/lib/passport/compress-passport-image";
import { passportImageOptimizeErrorMessage } from "@/lib/passport/passport-flow-messages";
import { processPassportPhotoFiles } from "@/lib/passport/process-passport-photo-files";

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
        });
    },
    [maxPhotos, onAdd, photos.length],
  );

  const displayError = error ?? dropError;

  return (
    <div>
      {canAddMore && (
        <PhotoDropZone
          onFiles={handleFiles}
          maxPhotos={maxPhotos}
          disabled={disabled}
          isOptimizing={isOptimizing}
          inputId="passport-photos"
        />
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
