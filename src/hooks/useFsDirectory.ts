import { useEffect, useState } from 'react';
import { listDirectory } from '../api/client';
import type { Listing } from '../lib/directory';

export interface FsDirectoryState {
  listing: Listing | null;
  error: string | null;
  loading: boolean;
  /** Time of the last successful listing. */
  loadedAt: Date | null;
}

/** Lists a host directory through `<base-url>/0/api/dir/` when the page loads. */
export function useFsDirectory(path: string): FsDirectoryState {
  const [listing, setListing] = useState<Listing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);

    listDirectory(path, { signal: controller.signal })
      .then((entries) => {
        setListing(entries);
        setError(null);
        setLoadedAt(new Date());
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : String(cause));
        setListing(null);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [path]);

  return { listing, error, loading, loadedAt };
}
