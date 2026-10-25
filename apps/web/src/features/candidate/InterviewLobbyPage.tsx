import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, Building2, CheckCircle2, Clock, Code2, MessageSquare, Mic, MicOff, PlayCircle, ShieldCheck, Wifi } from 'lucide-react';
import type { InterviewDto } from '@hws/shared';
import { Button, Card, CardContent, Checkbox, Label, PageHeader, PageLoader, StatusBadge, Textarea } from '@/components/ui';
import { get, post } from '@/lib/api';
import { useDocumentTitle } from '@/lib/hooks';
import { errorMessage, qk, queryClient } from '@/lib/query';
import { STATUS_LABEL, cn, fmtDate } from '@/lib/utils';

function roomFor(i: InterviewDto, sectionIndex: number) {
  const type = i.sections[sectionIndex]?.type ?? i.plan.sections[0]?.type;
  return `/app/interviews/${i.id}/${type === 'coding' ? 'coding' : 'room'}`;
}

function MicCheck() {
  const [state, setState] = useState<'idle' | 'ok' | 'denied' | 'unsupported'>('idle');
  const supported = typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);
  const speech = typeof window !== 'undefined' && ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window);
  async function check() {
    if (!supported) return setState('unsupported');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      setState('ok');
    } catch {
      setState('denied');
    }
  }
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div className="text-sm">
        <div className="font-medium">Microphone (optional)</div>
        <p className="text-muted">
          You can type every answer. Voice input works best in Chrome or Edge.{' '}
          {!speech ? <span className="text-warning">This browser does not support speech recognition; you will type your answers.</span> : null}
        </p>
      </div>
      <div className="flex items-center gap-2" aria-live="polite">
        {state === 'ok' ? (
          <span className="inline-flex items-center gap-1 text-sm text-success">
            <Mic className="size-4" /> Microphone works
          </span>
        ) : state === 'denied' ? (
          <span className="inline-flex items-center gap-1 text-sm text-warning">
            <MicOff className="size-4" /> Access denied — typing still works
          </span>
        ) : state === 'unsupported' ? (
          <span className="text-sm text-muted">Not available in this browser</span>
        ) : null}
        <Button variant="outline" size="sm" onClick={check}>
          Test microphone
        </Button>
      </div>
    </div>
  );
}

export default function InterviewLobbyPage() {
  useDocumentTitle('Interview lobby');
  const { id = '' } = useParams();
  const nav = useNavigate();
  const q = useQuery({ queryKey: qk.interview(id), queryFn: () => get<InterviewDto>(`/interviews/${id}`) });
  const disclosure = useQuery({ queryKey: qk.disclosure, queryFn: () => get<{ version: string; text: string }>('/interviews/disclosure'), staleTime: Infinity });
  const [agreed, setAgreed] = useState(false);
  const [accommodation, setAccommodation] = useState('');

  useEffect(() => {
    const s = q.data?.status;
    if (s && ['submitted', 'completed', 'expired'].includes(s)) nav(`/app/interviews/${id}/done`, { replace: true });
  }, [q.data?.status, id, nav]);

  const consent = useMutation({
    mutationFn: () => post(`/interviews/${id}/consent`, { disclosureVersion: disclosure.data!.version, accepted: true, ...(accommodation.trim() ? { accommodationRequest: accommodation.trim() } : {}) }),
    onSuccess: () => {
      toast.success('Consent recorded');
      queryClient.invalidateQueries({ queryKey: qk.interview(id) });
    },
  });
  const start = useMutation({
    mutationFn: () => post<InterviewDto>(`/interviews/${id}/start`),
    onSuccess: (i) => {
      queryClient.setQueryData(qk.interview(id), i);
      nav(roomFor(i, i.currentSection ?? 0));
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  if (q.isPending) return <PageLoader />;
  if (q.isError || !q.data) return <p className="text-sm text-muted">Interview not found.</p>;
  const i = q.data;
  const total = i.plan.sections.reduce((s, x) => s + x.durationMinutes, 0);
  const windowClosed = i.completeBy ? new Date(i.completeBy) < new Date(i.serverTime) : false;
  const needsConsent = !i.consentedAt;

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-1">
            <Building2 className="size-3.5" /> {i.organizationName}
          </span>
        }
        title={i.jobTitle}
        description={`AI-assisted interview · about ${total} minutes`}
        actions={<StatusBadge status={i.status} label={STATUS_LABEL[i.status]} />}
      />

      <Card className="mb-6">
        <CardContent className="p-5">
          <h2 className="font-semibold">What to expect</h2>
          <ul className="mt-3 divide-y">
            {i.sections.map((s) => (
              <li key={s.index} className="flex items-center justify-between py-2.5 text-sm">
                <span className="flex items-center gap-2">
                  {s.type === 'coding' ? <Code2 className="size-4 text-accent" /> : <MessageSquare className="size-4 text-accent" />}
                  <span>
                    <span className="font-medium">
                      Section {s.index + 1}: {s.title}
                    </span>
                    {s.status === 'done' ? <CheckCircle2 className="ml-2 inline size-4 text-success" /> : null}
                  </span>
                </span>
                <span className="flex items-center gap-1 text-muted">
                  <Clock className="size-3.5" /> {s.durationMinutes} min
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-muted">
            Each section has its own timer that starts when you enter it. {i.completeBy ? `Complete everything by ${fmtDate(i.completeBy)}.` : ''}
          </p>
        </CardContent>
      </Card>

      {i.status === 'cancelled' ? (
        <Card>
          <CardContent className="flex items-start gap-3 p-5 text-sm">
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-warning" />
            <div>
              <div className="font-medium">This interview was withdrawn by the employer.</div>
              <p className="mt-1 text-muted">If you believe this is a mistake, please contact {i.organizationName} directly.</p>
            </div>
          </CardContent>
        </Card>
      ) : i.status === 'in_progress' ? (
        <Card>
          <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm">
              <div className="font-medium">Your interview is in progress.</div>
              <p className="text-muted">Section timers keep running while you are away. Return as soon as you can.</p>
            </div>
            <Button size="lg" onClick={() => nav(roomFor(i, i.currentSection ?? 0))}>
              <PlayCircle /> Resume interview
            </Button>
          </CardContent>
        </Card>
      ) : windowClosed ? (
        <Card>
          <CardContent className="flex items-start gap-3 p-5 text-sm">
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-warning" />
            <div>
              <div className="font-medium">The completion window for this interview has passed.</div>
              <p className="mt-1 text-muted">Please contact {i.organizationName} if you would like to request a new invitation.</p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          <Card>
            <CardContent className="space-y-4 p-5">
              <h2 className="font-semibold">1. Get ready</h2>
              <ul className="grid gap-2 text-sm sm:grid-cols-3">
                <li className="flex items-center gap-2 rounded-md bg-surface-2 p-3">
                  <Wifi className="size-4 text-accent" /> Stable internet connection
                </li>
                <li className="flex items-center gap-2 rounded-md bg-surface-2 p-3">
                  <Clock className="size-4 text-accent" /> {total} uninterrupted minutes
                </li>
                <li className="flex items-center gap-2 rounded-md bg-surface-2 p-3">
                  <ShieldCheck className="size-4 text-accent" /> Stay in this tab while answering
                </li>
              </ul>
              <MicCheck />
            </CardContent>
          </Card>

          <Card className={cn(!needsConsent && 'opacity-80')}>
            <CardContent className="space-y-4 p-5">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold">2. AI disclosure and consent</h2>
                {!needsConsent ? (
                  <span className="inline-flex items-center gap-1 text-sm text-success">
                    <CheckCircle2 className="size-4" /> Recorded {fmtDate(i.consentedAt)}
                  </span>
                ) : null}
              </div>
              {disclosure.isPending ? (
                <p className="text-sm text-muted">Loading notice…</p>
              ) : disclosure.data ? (
                <div className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded-md border bg-surface-2 p-4 text-sm leading-relaxed scrollbar-thin" tabIndex={0} aria-label="AI disclosure notice">
                  {disclosure.data.text}
                </div>
              ) : (
                <p className="text-sm text-danger">Could not load the disclosure notice.</p>
              )}
              {needsConsent ? (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="accommodation">Accommodation or alternative process request (optional)</Label>
                    <Textarea id="accommodation" value={accommodation} onChange={(e) => setAccommodation(e.target.value)} placeholder="Tell the employer if you need extra time, an alternative format, or other support." maxLength={2000} />
                  </div>
                  <div className="flex items-start gap-2">
                    <Checkbox id="agree" checked={agreed} onCheckedChange={(v) => setAgreed(v === true)} className="mt-0.5" />
                    <Label htmlFor="agree" className="leading-snug">
                      I have read the notice and agree to proceed with the AI-assisted interview.
                    </Label>
                  </div>
                  <Button onClick={() => consent.mutate()} disabled={!agreed || !disclosure.data} loading={consent.isPending}>
                    Record consent
                  </Button>
                </>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-sm">
                <h2 className="font-semibold">3. Start the interview</h2>
                <p className="text-muted">The first section timer starts immediately. You cannot pause once started.</p>
              </div>
              <Button size="lg" disabled={needsConsent} loading={start.isPending} onClick={() => start.mutate()}>
                <PlayCircle /> Start interview
              </Button>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
