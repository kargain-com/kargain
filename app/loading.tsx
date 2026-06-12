export default function Loading() {
  return (
    <div
      className="flex min-h-[50dvh] items-center justify-center bg-bg-primary text-sm text-text-secondary"
      role="status"
      aria-live="polite"
    >
      Loading…
    </div>
  );
}
