import { useSyncExternalStore } from "react";

// Minimal keyed async cache read through useSyncExternalStore: components ask
// for a key, the first reader starts the fetch, everyone re-renders when it lands.

type Entry = { status: "loading" | "done" | "error"; data?: unknown; error?: string; retryAt?: number };

const RETRY_MS = 5000;

const cache = new Map<string, Entry>();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function start(key: string, load: () => Promise<unknown>) {
  cache.set(key, { status: "loading" });
  load().then(
    (data) => {
      cache.set(key, { status: "done", data });
      notify();
    },
    (e: unknown) => {
      cache.set(key, { status: "error", error: e instanceof Error ? e.message : String(e), retryAt: Date.now() + RETRY_MS });
      notify();
    }
  );
}

const IDLE: Entry = { status: "loading" };

export function useQuery<T>(key: string | null, load: () => Promise<T>): { data?: T; loading: boolean; error?: string } {
  const existing = key ? cache.get(key) : undefined;
  // Failures are retried on a later render rather than cached forever.
  if (key && (!existing || (existing.status === "error" && Date.now() >= (existing.retryAt ?? 0)))) start(key, load);
  const entry = useSyncExternalStore(subscribe, () => (key ? cache.get(key) ?? IDLE : IDLE));
  if (!key) return { loading: false };
  return { data: entry.data as T | undefined, loading: entry.status === "loading", error: entry.error };
}
