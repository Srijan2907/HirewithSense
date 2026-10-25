/**
 * Bundle Monaco locally (no CDN) and wire its web workers for Vite. Imported lazily by the coding
 * room so the main bundle stays small.
 */
import * as monaco from 'monaco-editor';
import { loader } from '@monaco-editor/react';
import editorWorker from 'monaco-editor/editor/editor.worker?worker';
import tsWorker from 'monaco-editor/language/typescript/ts.worker?worker';
import jsonWorker from 'monaco-editor/language/json/json.worker?worker';

declare global {
  interface Window {
    MonacoEnvironment?: { getWorker: (workerId: string, label: string) => Worker };
  }
}

let configured = false;
export function setupMonaco() {
  if (configured) return monaco;
  configured = true;
  self.MonacoEnvironment = {
    getWorker(_: string, label: string) {
      if (label === 'typescript' || label === 'javascript') return new tsWorker();
      if (label === 'json') return new jsonWorker();
      return new editorWorker();
    },
  };
  loader.config({ monaco });
  return monaco;
}
