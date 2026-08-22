import { useEffect, useState } from 'react';
import { readFileBytes } from '../api/client';

export interface FsBytesState {
  bytes: Uint8Array | null;
  error: string | null;
  loading: boolean;
  /** Time of the last successful read. */
  loadedAt: Date | null;
}

/**
 * Reads a host file as bytes when the page loads — `useFsFile` for the entries
 * that are not text. See {@link readFileBytes}, which says which those are.
 */
export function useFsBytes(path: string): FsBytesState {
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);

    readFileBytes(path, { signal: controller.signal })
      .then((read) => {
        setBytes(read);
        setError(null);
        setLoadedAt(new Date());
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : String(cause));
        setBytes(null);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [path]);

  return { bytes, error, loading, loadedAt };
}
