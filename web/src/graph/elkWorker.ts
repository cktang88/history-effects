/// <reference types="vite/client" />
// ELK running in a Web Worker: the layout engine (~1.5 MB) loads off the
// main bundle and computes off the main thread.
import ElkApi from "elkjs/lib/elk-api.js";
import workerUrl from "elkjs/lib/elk-worker.min.js?url";

export function createWorkerElk() {
  return new ElkApi({ workerFactory: () => new Worker(workerUrl) });
}
