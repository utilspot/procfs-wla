import { useEffect, useState } from 'react';
import { readFile } from '../api/client';

export interface FsFileState {
  content: string | null;
  error: string | null;
  loading: boolean;
  /** Time of the last successful read. */
  loadedAt: Date | null;
}

/** Reads a host file through `<base-url><path>` when the page loads. */
export function useFsFile(path: string): FsFileState {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);

    readFile(path, { signal: controller.signal })
      .then((text) => {
        setContent(text);
        setError(null);
        setLoadedAt(new Date());
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : String(cause));
        setContent(null);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [path]);

  return { content, error, loading, loadedAt };
}
