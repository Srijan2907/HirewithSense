import { useCallback, useEffect, useRef } from 'react';
import { ShieldCheck } from 'lucide-react';
import type { ProctoringEventType } from '@hws/shared';
import { post } from '@/lib/api';

interface PendingEvent {
  type: ProctoringEventType;
  at: string;
  sectionIndex?: number | null;
  meta?: Record<string, string | number | boolean>;
}

/**
 * Records disclosed interface events (focus, visibility, fullscreen, network, paste/copy) and ships
 * them to the API in small batches. Content is never captured, only event types and lengths.
 */
export function useProctoring(interviewId: string | undefined, sectionIndex: number | null | undefined, enabled = true) {
  const queue = useRef<PendingEvent[]>([]);
  const sectionRef = useRef(sectionIndex);
  sectionRef.current = sectionIndex;

  const flush = useCallback(async () => {
    if (!interviewId || !queue.current.length) return;
    const events = queue.current.splice(0, 100);
    try {
      await post(`/interviews/${interviewId}/events`, { events });
    } catch {
      /* telemetry is best-effort */
    }
  }, [interviewId]);

  const record = useCallback(
    (type: ProctoringEventType, meta?: Record<string, string | number | boolean>) => {
      if (!enabled) return;
      queue.current.push({ type, at: new Date().toISOString(), sectionIndex: sectionRef.current ?? null, ...(meta ? { meta } : {}) });
      if (queue.current.length >= 20) void flush();
    },
    [enabled, flush],
  );

  useEffect(() => {
    if (!enabled || !interviewId) return;
    const onBlur = () => record('focus_lost');
    const onFocus = () => record('focus_gained');
    const onVisibility = () => record(document.visibilityState === 'hidden' ? 'tab_hidden' : 'tab_visible');
    const onFullscreen = () => record(document.fullscreenElement ? 'fullscreen_enter' : 'fullscreen_exit');
    const onOffline = () => record('network_offline');
    const onOnline = () => record('network_online');
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    document.addEventListener('fullscreenchange', onFullscreen);
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);
    const timer = setInterval(() => void flush(), 5000);
    return () => {
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
      document.removeEventListener('fullscreenchange', onFullscreen);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
      clearInterval(timer);
      void flush();
    };
  }, [enabled, interviewId, record, flush]);

  const recordPaste = useCallback((length: number) => record('paste', { length }), [record]);
  const recordCopy = useCallback(() => record('copy'), [record]);
  return { recordPaste, recordCopy, flush };
}

export function ProctoringNotice({ className }: { className?: string }) {
  return (
    <p className={`flex items-center gap-1.5 text-xs text-muted ${className ?? ''}`}>
      <ShieldCheck className="size-3.5 shrink-0" aria-hidden />
      Interface events (focus changes, pasting, full-screen) are recorded, as described in the notice you accepted.
    </p>
  );
}
