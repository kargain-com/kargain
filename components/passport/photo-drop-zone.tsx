"use client";

import { useRef, useState } from "react";

import { ExportIcon } from "@/components/ui/icons";
import { cn } from "@/lib/utils";

type PhotoDropZoneProps = {
  onFiles: (files: FileList | File[]) => void;
  maxPhotos: number;
  disabled?: boolean;
  isOptimizing?: boolean;
  /** Defaults to `passport-photos` (create). Edit should pass a distinct id. */
  inputId?: string;
  className?: string;
};

export function PhotoDropZone({
  onFiles,
  maxPhotos,
  disabled,
  isOptimizing,
  inputId = "passport-photos",
  className,
}: PhotoDropZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const zoneDisabled = Boolean(disabled || isOptimizing);

  const deliver = (fileList: FileList | File[]) => {
    if (zoneDisabled) return;
    const files = Array.from(fileList);
    if (files.length === 0) return;
    onFiles(files);
    if (inputRef.current) inputRef.current.value = "";
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (!zoneDisabled) setDragOver(true);
  };

  const onDragLeave = () => {
    setDragOver(false);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (zoneDisabled) return;
    if (e.dataTransfer.files.length > 0) {
      deliver(e.dataTransfer.files);
    }
  };

  return (
    <div
      className={className}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        accept="image/*,.heic,.heif"
        id={inputId}
        className="sr-only"
        disabled={zoneDisabled}
        onChange={(e) => {
          if (e.target.files) deliver(e.target.files);
        }}
      />
      <label
        htmlFor={inputId}
        className={cn(
          "block cursor-pointer rounded-md border-2 border-dashed p-8 text-center transition-colors duration-200",
          dragOver
            ? "border-accent-warm bg-bg-card"
            : "border-border-default bg-bg-surface hover:border-border-hover",
          zoneDisabled && "cursor-not-allowed opacity-50",
        )}
      >
        <ExportIcon
          size={32}
          className="mx-auto mb-3 text-text-tertiary"
          aria-hidden
        />
        <p className="font-sans text-sm text-text-secondary">
          {isOptimizing
            ? "Optimizing photos…"
            : "Drag photos here or click to upload"}
        </p>
        <p className="mt-1 font-mono text-xs text-text-tertiary">
          JPEG, PNG, WebP, HEIC · optimized to WebP (up to 100 KB each) · up to{" "}
          {maxPhotos} photos
        </p>
      </label>
    </div>
  );
}
