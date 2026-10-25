import { useEffect, useRef, useState } from 'react';

/** Seconds remaining until `deadlineIso`, corrected for server/client clock skew (`serverTimeIso` sampled at fetch). */
export function useCountdown(deadlineIso: string | null | undefined, serverTimeIso?: string | null): number | null {
  const skewRef = useRef(0);
  useEffect(() => {
    if (serverTimeIso) skewRef.current = new Date(serverTimeIso).getTime() - Date.now();
  }, [serverTimeIso]);
  const [remaining, setRemaining] = useState<number | null>(null);
  useEffect(() => {
    if (!deadlineIso) {
      setRemaining(null);
      return;
    }
    const tick = () => setRemaining(Math.max(0, Math.round((new Date(deadlineIso).getTime() - (Date.now() + skewRef.current)) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [deadlineIso]);
  return remaining;
}

export function useDebouncedCallback<A extends unknown[]>(fn: (...args: A) => void, delay: number) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  return (...args: A) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => fnRef.current(...args), delay);
  };
}

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => (typeof window !== 'undefined' ? window.matchMedia(query).matches : false));
  useEffect(() => {
    const m = window.matchMedia(query);
    const handler = () => setMatches(m.matches);
    m.addEventListener('change', handler);
    return () => m.removeEventListener('change', handler);
  }, [query]);
  return matches;
}

export function useDocumentTitle(title: string) {
  useEffect(() => {
    const prev = document.title;
    document.title = `${title} · HireWithSense`;
    return () => {
      document.title = prev;
    };
  }, [title]);
}
