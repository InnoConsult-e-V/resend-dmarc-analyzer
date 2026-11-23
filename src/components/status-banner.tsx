'use client';

interface StatusBannerProps {
  error: string | null;
  note: string | null;
  onDismissError: () => void;
  onDismissNote: () => void;
}

/** Status and error messages, shown directly under the app header. */
export function StatusBanner({
  error,
  note,
  onDismissError,
  onDismissNote,
}: StatusBannerProps) {
  if (!error && !note) {
    return null;
  }
  return (
    <div className="max-w-6xl mx-auto px-4 pt-4 space-y-2" aria-live="polite">
      {error && (
        <div
          role="alert"
          className="flex items-start justify-between gap-4 bg-red-dim border border-red/30 rounded-lg px-4 py-3 text-sm text-red"
        >
          <span>{error}</span>
          <button
            type="button"
            onClick={onDismissError}
            className="shrink-0 opacity-70 hover:opacity-100"
            aria-label="Dismiss error"
          >
            ✕
          </button>
        </div>
      )}
      {note && (
        <div className="flex items-start justify-between gap-4 bg-gray-2 border border-gray-3 rounded-lg px-4 py-3 text-sm text-gray-8">
          <span>{note}</span>
          <button
            type="button"
            onClick={onDismissNote}
            className="shrink-0 text-gray-6 hover:text-gray-9"
            aria-label="Dismiss message"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
