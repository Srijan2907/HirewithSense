/** Minimal typings and helpers for the browser Web Speech API (Chrome/Edge/Safari). */

export interface RecognitionResultLike {
  isFinal: boolean;
  0: { transcript: string };
}
export interface RecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<RecognitionResultLike>;
}
export interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: RecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

export function createRecognition(): SpeechRecognitionLike | null {
  const w = window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  if (!Ctor) return null;
  const r = new Ctor();
  r.continuous = true;
  r.interimResults = true;
  r.lang = navigator.language || 'en-US';
  return r;
}

export const speechRecognitionSupported = () => {
  const w = window as unknown as Record<string, unknown>;
  return Boolean(w.SpeechRecognition || w.webkitSpeechRecognition);
};

export const speechSynthesisSupported = () => typeof window !== 'undefined' && 'speechSynthesis' in window;

export function speak(text: string, onEnd?: () => void): void {
  if (!speechSynthesisSupported()) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 1;
  u.pitch = 1;
  const voices = window.speechSynthesis.getVoices();
  const preferred = voices.find((v) => v.lang.startsWith('en') && /Google|Natural|Samantha|Daniel/i.test(v.name)) ?? voices.find((v) => v.lang.startsWith('en'));
  if (preferred) u.voice = preferred;
  if (onEnd) u.onend = onEnd;
  u.onerror = () => onEnd?.();
  window.speechSynthesis.speak(u);
}

export function stopSpeaking(): void {
  if (speechSynthesisSupported()) window.speechSynthesis.cancel();
}

/* ------------------------- server-backed speech (optional) ------------------------- */

import { API_BASE, api } from '@/lib/api';

let currentAudio: HTMLAudioElement | null = null;
let currentUrl: string | null = null;

/** Text-to-speech through the API (`POST /ai/speak`). Falls back to the browser voice on failure. */
export async function speakViaServer(text: string, onEnd?: () => void): Promise<void> {
  stopSpeaking();
  try {
    const res = await api<Response>('/ai/speak', { method: 'POST', body: { text }, raw: true });
    const blob = await res.blob();
    currentUrl = URL.createObjectURL(blob);
    currentAudio = new Audio(currentUrl);
    currentAudio.onended = () => {
      cleanupAudio();
      onEnd?.();
    };
    currentAudio.onerror = () => {
      cleanupAudio();
      speak(text, onEnd);
    };
    await currentAudio.play();
  } catch {
    cleanupAudio();
    speak(text, onEnd);
  }
}

function cleanupAudio() {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }
  if (currentUrl) {
    URL.revokeObjectURL(currentUrl);
    currentUrl = null;
  }
}

/** Stop both browser and server playback. */
export function stopAllSpeech(): void {
  cleanupAudio();
  stopSpeaking();
}

export const mediaRecorderSupported = () => typeof window !== 'undefined' && 'MediaRecorder' in window && Boolean(navigator.mediaDevices?.getUserMedia);

/**
 * Records microphone audio and sends it to `POST /ai/transcribe` when stopped. Used when the server
 * has transcription enabled, which works in every browser (unlike SpeechRecognition).
 */
export class ServerRecorder {
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private stream: MediaStream | null = null;

  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].find((m) => MediaRecorder.isTypeSupported(m));
    this.recorder = new MediaRecorder(this.stream, mime ? { mimeType: mime } : undefined);
    this.chunks = [];
    this.recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };
    this.recorder.start(1000);
  }

  get active(): boolean {
    return this.recorder?.state === 'recording';
  }

  /** Stop recording and return the transcript (empty string when nothing was captured). */
  async stop(): Promise<string> {
    const recorder = this.recorder;
    if (!recorder) return '';
    const done = new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
    });
    if (recorder.state !== 'inactive') recorder.stop();
    await done;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.recorder = null;
    const blob = new Blob(this.chunks, { type: recorder.mimeType || 'audio/webm' });
    this.chunks = [];
    if (blob.size < 1000) return '';
    const ext = blob.type.includes('mp4') ? 'mp4' : blob.type.includes('ogg') ? 'ogg' : 'webm';
    const form = new FormData();
    form.append('audio', blob, `answer.${ext}`);
    const res = await api<{ text: string }>('/ai/transcribe', { method: 'POST', body: form });
    return res.text.trim();
  }

  abort(): void {
    if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.recorder = null;
    this.chunks = [];
  }
}

void API_BASE;
