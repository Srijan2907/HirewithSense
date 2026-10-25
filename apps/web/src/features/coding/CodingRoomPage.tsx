import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, History, Play, RotateCcw, Send, Sparkles } from 'lucide-react';
import type { z } from 'zod';
import type { CandidateProblemDto, InterviewDto, LanguageId, SubmissionDto } from '@hws/shared';
import type { DraftDto as DraftDtoSchema, LanguageInfo as LanguageInfoSchema } from '@hws/shared';
type DraftDto = z.infer<typeof DraftDtoSchema>;
type LanguageInfo = z.infer<typeof LanguageInfoSchema>;
import { Button, Dialog, DialogContent, DialogFooter, NativeSelect, PageLoader, Spinner, StatusBadge, Tooltip } from '@/components/ui';
import { get, isApiError, post, put } from '@/lib/api';
import { errorMessage, qk, queryClient } from '@/lib/query';
import { useDebouncedCallback, useDocumentTitle } from '@/lib/hooks';
import { cn, fmtRelative } from '@/lib/utils';
import { InterviewHeader, routeAfterSection } from '../interview/InterviewHeader';
import { ProctoringNotice, useProctoring } from '../interview/useProctoring';
import { ProblemStatement, ProblemTabs } from './ProblemPane';
import { ResultsPane } from './ResultsPane';
import { STARTER } from './starter';

const Editor = lazy(() => import('@monaco-editor/react'));

interface CodingState {
  sectionIndex: number;
  deadline: string | null;
  languageIds: string[];
  problems: CandidateProblemDto[];
  drafts: DraftDto[];
  submissions: SubmissionDto[];
  languages: LanguageInfo[];
}

export default function CodingRoomPage() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  useDocumentTitle('Coding round');

  const interviewQuery = useQuery({ queryKey: qk.interview(id), queryFn: () => get<InterviewDto>(`/interviews/${id}`), enabled: Boolean(id), staleTime: 0, meta: { silent: true } });
  const codingQuery = useQuery({
    queryKey: qk.coding(id),
    queryFn: () => get<CodingState>(`/interviews/${id}/coding`),
    enabled: Boolean(id) && interviewQuery.data?.status === 'in_progress',
    staleTime: 0,
    retry: false,
    meta: { silent: true },
  });

  const interview = interviewQuery.data;
  const state = codingQuery.data;

  const [activeId, setActiveId] = useState<string>('');
  const [language, setLanguage] = useState<LanguageId>('javascript');
  const [code, setCode] = useState<Record<string, string>>({});
  const [customInput, setCustomInput] = useState('');
  const [showCustom, setShowCustom] = useState(false);
  const [running, setRunning] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [latest, setLatest] = useState<Record<string, SubmissionDto | null>>({});
  const [submissions, setSubmissions] = useState<SubmissionDto[]>([]);
  const [ending, setEnding] = useState(false);
  const [timeUp, setTimeUp] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [review, setReview] = useState<{ feedback: string; followUpQuestions: string[] } | null>(null);
  const [reviewAnswer, setReviewAnswer] = useState('');
  const [reviewing, setReviewing] = useState(false);
  const [tab, setTab] = useState<'results' | 'history'>('results');
  const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains('dark'));
  const editorRef = useRef<import('monaco-editor').editor.IStandaloneCodeEditor | null>(null);

  const { recordPaste, recordCopy } = useProctoring(id, state?.sectionIndex ?? interview?.currentSection ?? null, interview?.status === 'in_progress');

  // Redirect when the interview is not in a coding section.
  useEffect(() => {
    if (!interview) return;
    if (interview.status !== 'in_progress') {
      nav(interview.status === 'ready' || interview.status === 'invited' ? `/app/interviews/${id}` : `/app/interviews/${id}/done`, { replace: true });
      return;
    }
    const cur = interview.currentSection;
    if (cur !== null && interview.plan.sections[cur]?.type !== 'coding') nav(`/app/interviews/${id}/room`, { replace: true });
  }, [interview, id, nav]);

  useEffect(() => {
    if (codingQuery.error && isApiError(codingQuery.error)) {
      if (codingQuery.error.status === 410) setTimeUp(true);
      else if (codingQuery.error.status === 409) interviewQuery.refetch();
    }
  }, [codingQuery.error, interviewQuery]);

  // Initialise editor state from server state once.
  const initialised = useRef(false);
  useEffect(() => {
    if (!state || initialised.current) return;
    initialised.current = true;
    const first = state.problems[0];
    if (!first) return;
    setActiveId(first.id);
    const avail = state.languages.filter((l) => l.available).map((l) => l.id);
    const firstDraft = state.drafts.find((d) => d.problemId === first.id);
    const lang = (firstDraft?.languageId ?? avail[0] ?? state.languages[0]?.id ?? 'javascript') as LanguageId;
    setLanguage(lang);
    const codeMap: Record<string, string> = {};
    for (const p of state.problems) {
      const d = state.drafts.find((x) => x.problemId === p.id);
      codeMap[p.id] = d?.sourceCode ?? p.starterCode[lang] ?? STARTER[lang];
    }
    setCode(codeMap);
    setSubmissions(state.submissions);
    const latestMap: Record<string, SubmissionDto | null> = {};
    for (const s of state.submissions) if (!latestMap[s.problemId]) latestMap[s.problemId] = s;
    setLatest(latestMap);
  }, [state]);

  useEffect(() => {
    const obs = new MutationObserver(() => setIsDark(document.documentElement.classList.contains('dark')));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    if (interview?.status !== 'in_progress') return;
    const handler = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [interview?.status]);

  const problem = useMemo(() => state?.problems.find((p) => p.id === activeId) ?? null, [state, activeId]);
  const source = code[activeId] ?? '';
  const langInfo = state?.languages.find((l) => l.id === language);
  const langAllowed = Boolean(problem?.languageIds.includes(language));

  const saveDraft = useDebouncedCallback((problemId: string, languageId: LanguageId, sourceCode: string) => {
    put(`/interviews/${id}/coding/draft`, { problemId, languageId, sourceCode }).catch(() => {});
  }, 1500);

  const onChange = (value: string | undefined) => {
    const v = value ?? '';
    setCode((c) => ({ ...c, [activeId]: v }));
    saveDraft(activeId, language, v);
  };

  const goOn = useCallback(
    (next: InterviewDto) => {
      queryClient.invalidateQueries({ queryKey: qk.interview(id) });
      nav(routeAfterSection(next), { replace: true });
    },
    [id, nav],
  );

  const completeSection = useCallback(async () => {
    const idx = state?.sectionIndex ?? interview?.currentSection;
    if (idx === null || idx === undefined) return;
    setEnding(true);
    try {
      // Persist the current draft before leaving.
      if (activeId && source) await put(`/interviews/${id}/coding/draft`, { problemId: activeId, languageId: language, sourceCode: source }).catch(() => {});
      const next = await post<InterviewDto>(`/interviews/${id}/sections/${idx}/complete`);
      goOn(next);
    } catch (err) {
      if (isApiError(err) && err.status === 409) goOn(await get<InterviewDto>(`/interviews/${id}`));
      else toast.error(errorMessage(err));
    } finally {
      setEnding(false);
    }
  }, [state?.sectionIndex, interview?.currentSection, activeId, source, id, language, goOn]);

  const onTimeUp = useCallback(() => {
    setTimeUp(true);
    void completeSection();
  }, [completeSection]);

  const handleRunError = async (err: unknown) => {
    if (isApiError(err) && err.status === 410) {
      onTimeUp();
      return;
    }
    if (isApiError(err) && err.status === 503) toast.error(`${langInfo?.label ?? language} is not available on this server right now. Try another language.`);
    else toast.error(errorMessage(err));
  };

  const run = async () => {
    if (!problem || running) return;
    setRunning(true);
    setTab('results');
    try {
      const res = await post<SubmissionDto>(`/interviews/${id}/coding/run`, { problemId: problem.id, languageId: language, sourceCode: source, ...(showCustom && customInput ? { customInput } : {}) });
      setLatest((l) => ({ ...l, [problem.id]: res }));
      setSubmissions((s) => [res, ...s]);
    } catch (err) {
      await handleRunError(err);
    } finally {
      setRunning(false);
    }
  };

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => () => {
    if (pollRef.current) clearInterval(pollRef.current);
  }, []);

  const submit = async () => {
    if (!problem || submitting || !source.trim()) return;
    setSubmitting(true);
    setTab('results');
    setReview(null);
    try {
      const queued = await post<SubmissionDto>(`/interviews/${id}/coding/submit`, { problemId: problem.id, languageId: language, sourceCode: source });
      setLatest((l) => ({ ...l, [problem.id]: queued }));
      setSubmissions((s) => [queued, ...s]);
      await new Promise<void>((resolve) => {
        const tick = async () => {
          try {
            const s = await get<SubmissionDto>(`/interviews/${id}/coding/submissions/${queued.id}`);
            setLatest((l) => ({ ...l, [problem.id]: s }));
            setSubmissions((list) => list.map((x) => (x.id === s.id ? s : x)));
            if (s.status === 'graded' || s.status === 'error') {
              if (pollRef.current) clearInterval(pollRef.current);
              pollRef.current = null;
              if (s.status === 'graded') toast.success(`Graded: ${s.passed}/${s.total} test cases passed`);
              resolve();
            }
          } catch {
            /* keep polling */
          }
        };
        pollRef.current = setInterval(tick, 1500);
        void tick();
      });
    } catch (err) {
      await handleRunError(err);
    } finally {
      setSubmitting(false);
    }
  };

  const requestReview = async () => {
    const s = latest[activeId];
    if (!s || s.status !== 'graded' || s.kind !== 'submit') return;
    setReviewing(true);
    try {
      setReview(await post(`/interviews/${id}/coding/submissions/${s.id}/review`));
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setReviewing(false);
    }
  };

  const sendReviewAnswer = async () => {
    if (!reviewAnswer.trim()) return;
    try {
      await post(`/interviews/${id}/transcript`, { text: reviewAnswer.trim(), turnId: null });
      toast.success('Your explanation was added to the transcript.');
      setReviewAnswer('');
      setReview(null);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const resetToStarter = () => {
    if (!problem) return;
    const v = problem.starterCode[language] ?? STARTER[language];
    setCode((c) => ({ ...c, [problem.id]: v }));
    saveDraft(problem.id, language, v);
    setConfirmReset(false);
  };

  const changeLanguage = (next: LanguageId) => {
    setLanguage(next);
    if (!problem) return;
    const current = code[problem.id] ?? '';
    const wasStarter = current.trim() === (problem.starterCode[language] ?? STARTER[language]).trim() || !current.trim();
    if (wasStarter) {
      const v = problem.starterCode[next] ?? STARTER[next];
      setCode((c) => ({ ...c, [problem.id]: v }));
      saveDraft(problem.id, next, v);
    } else saveDraft(problem.id, next, current);
  };

  if (interviewQuery.isLoading || (interview?.status === 'in_progress' && codingQuery.isLoading)) return <PageLoader label="Loading the coding round…" />;
  if (!interview) return <PageLoader />;
  if (codingQuery.isError && !timeUp) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
        <p className="text-sm text-muted">{errorMessage(codingQuery.error)}</p>
        <Button onClick={() => codingQuery.refetch()}>Try again</Button>
      </div>
    );
  }
  if (!state || !problem) return <PageLoader />;

  const current = latest[activeId] ?? null;
  const graded = current?.kind === 'submit' && current.status === 'graded';
  const history = submissions.filter((s) => s.problemId === activeId);

  return (
    <>
      <InterviewHeader interview={interview} deadline={state.deadline} onTimeUp={onTimeUp} onEndSection={completeSection} ending={ending} />
      <div className="flex min-h-0 flex-1 flex-col lg:grid lg:grid-cols-[minmax(320px,2fr)_minmax(0,3fr)]">
        {/* Problem pane */}
        <section className="flex min-h-0 flex-col border-b bg-surface lg:border-b-0 lg:border-r" aria-label="Problem">
          <ProblemTabs problems={state.problems} activeId={activeId} onSelect={setActiveId} submissions={submissions} />
          <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin max-h-[40vh] lg:max-h-none">
            <ProblemStatement problem={problem} />
          </div>
        </section>

        {/* Editor pane */}
        <section className="flex min-h-0 flex-1 flex-col" aria-label="Code editor">
          <div className="flex flex-wrap items-center gap-2 border-b bg-surface px-3 py-2">
            <label className="flex items-center gap-2 text-xs text-muted">
              Language
              <NativeSelect value={language} onChange={(e) => changeLanguage(e.target.value as LanguageId)} className="h-8 w-44 text-sm" aria-label="Programming language">
                {state.languages.map((l) => (
                  <option key={l.id} value={l.id} disabled={!l.available || !problem.languageIds.includes(l.id)}>
                    {l.label}
                    {!l.available ? ' (unavailable)' : !problem.languageIds.includes(l.id) ? ' (not allowed)' : ''}
                  </option>
                ))}
              </NativeSelect>
            </label>
            {langInfo && !langInfo.available ? (
              <span className="flex items-center gap-1 text-xs text-warning">
                <AlertTriangle className="size-3.5" /> This language cannot be executed on this server.
              </span>
            ) : null}
            <div className="ml-auto flex items-center gap-2">
              <Tooltip content="Replace your code with the starter template">
                <Button variant="ghost" size="sm" onClick={() => setConfirmReset(true)}>
                  <RotateCcw /> Reset
                </Button>
              </Tooltip>
              <Button variant="outline" size="sm" onClick={() => setShowCustom((s) => !s)} aria-pressed={showCustom}>
                Custom input
              </Button>
              <Button variant="secondary" size="sm" onClick={run} loading={running} disabled={!langInfo?.available || !langAllowed || submitting}>
                <Play /> Run samples
              </Button>
              <Button size="sm" onClick={submit} loading={submitting} disabled={!langInfo?.available || !langAllowed || running || !source.trim()}>
                <Send /> Submit
              </Button>
            </div>
          </div>

          <div className="min-h-[260px] flex-1 lg:min-h-0">
            <Suspense fallback={<div className="flex h-full items-center justify-center"><Spinner /></div>}>
              <Editor
                height="100%"
                language={langInfo?.monaco ?? 'plaintext'}
                value={source}
                theme={isDark ? 'vs-dark' : 'light'}
                beforeMount={() => import('@/lib/monaco').then((m) => m.setupMonaco())}
                onMount={(editor) => {
                  editorRef.current = editor;
                  editor.onDidPaste((e) => {
                    const text = editor.getModel()?.getValueInRange(e.range) ?? '';
                    recordPaste(text.length);
                  });
                  editor.onKeyDown((e) => {
                    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyC') recordCopy();
                  });
                  editor.focus();
                }}
                onChange={onChange}
                options={{ fontSize: 14, minimap: { enabled: false }, automaticLayout: true, tabSize: 2, scrollBeyondLastLine: false, wordWrap: 'on', fontFamily: 'JetBrains Mono, ui-monospace, monospace', padding: { top: 12 } }}
                loading={<div className="flex h-full items-center justify-center"><Spinner /></div>}
              />
            </Suspense>
          </div>

          {showCustom ? (
            <div className="border-t bg-surface px-3 py-2">
              <label htmlFor="custom-input" className="text-xs font-medium text-muted">
                Custom input (sent to stdin on “Run samples”)
              </label>
              <textarea id="custom-input" value={customInput} onChange={(e) => setCustomInput(e.target.value)} rows={3} className="mt-1 w-full rounded-md border bg-surface-2 p-2 font-mono text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent" placeholder="e.g. 3&#10;1 3&#10;2 6&#10;8 10" />
            </div>
          ) : null}

          {/* Results / history */}
          <div className="flex h-[38%] min-h-[180px] flex-col border-t bg-surface">
            <div className="flex items-center gap-1 border-b px-2" role="tablist">
              <button role="tab" aria-selected={tab === 'results'} onClick={() => setTab('results')} className={cn('px-3 py-2 text-sm cursor-pointer', tab === 'results' ? 'border-b-2 border-accent font-medium' : 'text-muted')}>
                Results
              </button>
              <button role="tab" aria-selected={tab === 'history'} onClick={() => setTab('history')} className={cn('flex items-center gap-1 px-3 py-2 text-sm cursor-pointer', tab === 'history' ? 'border-b-2 border-accent font-medium' : 'text-muted')}>
                <History className="size-3.5" /> Submissions ({history.filter((s) => s.kind === 'submit').length})
              </button>
              <div className="ml-auto flex items-center gap-2 pr-1">
                {graded ? (
                  <Button variant="ghost" size="sm" onClick={requestReview} loading={reviewing}>
                    <Sparkles /> Interviewer follow-up
                  </Button>
                ) : null}
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
              {tab === 'results' ? (
                <>
                  <ResultsPane submission={current} pending={running} />
                  {review ? (
                    <div className="mx-4 mb-4 rounded-lg border bg-surface-2 p-4 text-sm">
                      <div className="mb-2 flex items-center gap-2 font-medium">
                        <Sparkles className="size-4 text-accent" /> Interviewer follow-up
                      </div>
                      <p className="text-muted">{review.feedback}</p>
                      <ol className="mt-3 list-decimal space-y-1 pl-5">
                        {review.followUpQuestions.map((q, i) => (
                          <li key={i}>{q}</li>
                        ))}
                      </ol>
                      <label htmlFor="review-answer" className="mt-3 block text-xs font-medium text-muted">
                        Your explanation (added to the transcript)
                      </label>
                      <textarea id="review-answer" value={reviewAnswer} onChange={(e) => setReviewAnswer(e.target.value)} onPaste={(e) => recordPaste(e.clipboardData.getData('text').length)} rows={3} className="mt-1 w-full rounded-md border bg-surface p-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent" />
                      <div className="mt-2 flex justify-end">
                        <Button size="sm" onClick={sendReviewAnswer} disabled={!reviewAnswer.trim()}>
                          Send explanation
                        </Button>
                      </div>
                    </div>
                  ) : null}
                  <div className="px-4 pb-3">
                    <ProctoringNotice />
                  </div>
                </>
              ) : (
                <ul className="divide-y">
                  {history.length === 0 ? <li className="p-4 text-sm text-muted">No runs or submissions yet for this problem.</li> : null}
                  {history.map((s) => (
                    <li key={s.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setLatest((l) => ({ ...l, [activeId]: s }));
                          setTab('results');
                        }}
                        className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm hover:bg-surface-2 cursor-pointer"
                      >
                        <StatusBadge status={s.status} />
                        <span className="text-muted">{s.kind === 'run' ? 'Sample run' : 'Submission'}</span>
                        <span className="font-mono text-xs">{s.languageId}</span>
                        <span className="ml-auto text-xs text-muted">
                          {s.status === 'graded' ? `${s.passed}/${s.total} · ` : ''}
                          {fmtRelative(s.createdAt)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </section>
      </div>

      {timeUp ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6" role="alertdialog" aria-modal="true" aria-labelledby="timeup-title">
          <div className="max-w-sm rounded-lg border bg-surface p-6 text-center shadow-xl">
            <h2 id="timeup-title" className="text-lg font-semibold">
              Time is up
            </h2>
            <p className="mt-2 text-sm text-muted">Your latest draft and submissions have been saved. Moving on…</p>
            <div className="mt-4 flex justify-center">
              {ending ? <Spinner /> : <Button onClick={() => void completeSection()}>Continue</Button>}
            </div>
          </div>
        </div>
      ) : null}

      <Dialog open={confirmReset} onOpenChange={setConfirmReset}>
        <DialogContent title="Reset to starter code?" description="Your current code for this problem will be replaced. Previous submissions are kept.">
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmReset(false)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={resetToStarter}>
              Reset
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
