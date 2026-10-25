import { Link } from 'react-router';
import { ArrowRight, BadgeCheck, Code2, FileSearch, Mic, ScrollText, ShieldCheck, Sparkles, UserCheck, type LucideIcon } from 'lucide-react';
import { PublicLayout } from '@/app/layouts';
import { Button } from '@/components/ui';
import { useDocumentTitle } from '@/lib/hooks';

function Feature({ icon: Icon, title, text }: { icon: LucideIcon; title: string; text: string }) {
  return (
    <div className="rounded-lg border bg-surface p-5">
      <div className="mb-3 flex size-9 items-center justify-center rounded-md bg-accent/10 text-accent">
        <Icon className="size-5" />
      </div>
      <h3 className="font-semibold">{title}</h3>
      <p className="mt-1 text-sm leading-relaxed text-muted">{text}</p>
    </div>
  );
}

function Step({ n, title, text }: { n: number; title: string; text: string }) {
  return (
    <li className="flex gap-4">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-semibold text-accent-fg">{n}</span>
      <div>
        <h4 className="font-medium">{title}</h4>
        <p className="mt-0.5 text-sm text-muted">{text}</p>
      </div>
    </li>
  );
}

export default function LandingPage() {
  useDocumentTitle('AI-assisted technical interviews');
  return (
    <PublicLayout>
      <section className="mx-auto w-full max-w-6xl px-4 pb-16 pt-12 sm:px-8 sm:pt-20">
        <div className="max-w-3xl animate-fade-in">
          <span className="inline-flex items-center gap-1.5 rounded-full border bg-surface px-3 py-1 text-xs font-medium text-muted">
            <Sparkles className="size-3.5 text-accent" /> Structured interviews, evidence-anchored scoring, a human in charge
          </span>
          <h1 className="mt-5 text-4xl font-semibold tracking-tight sm:text-5xl">
            Technical interviews that scale <span className="text-accent">without losing fairness</span>
          </h1>
          <p className="mt-5 max-w-2xl text-lg text-muted">
            HireWithSense runs the first-round conversation and coding exercise for you: an AI interviewer asks resume- and role-grounded questions, candidates
            code in a real IDE, and recruiters get a report that quotes its evidence. Decisions stay with people.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Button asChild size="lg">
              <Link to="/register/recruiter">
                Start hiring <ArrowRight />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link to="/login">I have an invitation</Link>
            </Button>
          </div>
        </div>
      </section>

      <section className="border-y bg-surface">
        <div className="mx-auto grid w-full max-w-6xl gap-10 px-4 py-14 sm:px-8 lg:grid-cols-2">
          <div>
            <h2 className="text-xl font-semibold">For candidates</h2>
            <ol className="mt-5 space-y-5">
              <Step n={1} title="Accept your invitation" text="Open the emailed link, create an account in a minute, and upload your resume." />
              <Step n={2} title="Review the AI disclosure" text="See exactly what is recorded and how you are evaluated before you start. Request an accommodation if you need one." />
              <Step n={3} title="Interview from your browser" text="Answer by voice or text, then solve coding problems with sample tests you can run any time." />
              <Step n={4} title="A person reviews" text="Your recruiter reads the report, the transcript and your code. No decision is automatic." />
            </ol>
          </div>
          <div>
            <h2 className="text-xl font-semibold">For recruiters</h2>
            <ol className="mt-5 space-y-5">
              <Step n={1} title="Define the role" text="Describe the job, weight the competencies that matter, and add bank questions and coding problems." />
              <Step n={2} title="Invite candidates" text="Send email invitations individually or in bulk. Candidates complete the interview within your window." />
              <Step n={3} title="Read evidence, not vibes" text="Every competency score links to quotes from answers or test results. Integrity signals are shown separately." />
              <Step n={4} title="Decide and record why" text="Advance, hold or reject with a written reason. Rankings and audit exports are one click away." />
            </ol>
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-8">
        <h2 className="text-xl font-semibold">Built for trustworthy hiring</h2>
        <p className="mt-1 max-w-2xl text-sm text-muted">Designed around current AI-in-hiring regulation: disclosure, consent, human oversight, explainability and retention.</p>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Feature icon={ScrollText} title="Disclosure and consent" text="Candidates read a versioned notice and consent before starting. The exact text, timestamp and version are stored." />
          <Feature icon={UserCheck} title="A human decides" text="The system never rejects anyone. Recruiters make and justify every decision; overrides of the AI view are flagged." />
          <Feature icon={FileSearch} title="Evidence-anchored scores" text="Each competency is scored only when there is quotable evidence. Otherwise it is marked as not assessed, never guessed." />
          <Feature icon={ShieldCheck} title="Integrity kept separate" text="Focus changes, paste events and other signals are summarised in their own panel and never mixed into the score." />
          <Feature icon={Code2} title="Real coding, real tests" text="Candidates code in a Monaco IDE across popular languages. Hidden tests run in an isolated sandbox; correctness is computed, not estimated." />
          <Feature icon={Mic} title="Voice or text" text="Spoken answers are transcribed; only the content is evaluated. Accent, voice and appearance are never analysed." />
        </div>
      </section>

      <section className="border-t bg-surface">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-start gap-6 px-4 py-14 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <div>
            <h2 className="text-xl font-semibold">Ready to run better first rounds?</h2>
            <p className="mt-1 text-sm text-muted">Create a workspace, add your first role and invite a candidate in under ten minutes.</p>
          </div>
          <Button asChild size="lg">
            <Link to="/register/recruiter">
              Create your workspace <BadgeCheck />
            </Link>
          </Button>
        </div>
      </section>
      <footer className="px-4 py-6 text-center text-xs text-muted sm:px-8">© {new Date().getFullYear()} HireWithSense</footer>
    </PublicLayout>
  );
}
