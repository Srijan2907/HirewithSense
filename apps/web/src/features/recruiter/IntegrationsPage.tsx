import { useQuery } from '@tanstack/react-query';
import { Bot, Code2, ExternalLink, Mail } from 'lucide-react';
import type { AiStatusDto } from '@hws/shared';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, PageHeader, PageLoader } from '@/components/ui';
import { API_BASE, get } from '@/lib/api';
import { qk } from '@/lib/query';
import { useDocumentTitle } from '@/lib/hooks';

function Env({ children }: { children: string }) {
  return <code className="rounded bg-surface-2 px-1 py-0.5 text-xs">{children}</code>;
}

function OnOff({ on, label }: { on: boolean; label: string }) {
  return (
    <li className="flex items-center justify-between py-1 text-sm">
      <span>{label}</span>
      <Badge variant={on ? 'success' : 'muted'}>{on ? 'Enabled' : 'Off'}</Badge>
    </li>
  );
}

export default function IntegrationsPage() {
  useDocumentTitle('Integrations');
  const q = useQuery({ queryKey: qk.aiStatus, queryFn: () => get<AiStatusDto>('/ai/status') });
  if (q.isLoading) return <PageLoader />;
  const s = q.data;
  const docsUrl = `${API_BASE || window.location.origin.replace(/:\d+$/, ':4000')}/docs`;
  return (
    <>
      <PageHeader
        title="Integrations"
        description="Server-side capabilities as currently configured. These are set by environment variables on the API."
        actions={
          <Button asChild variant="outline">
            <a href={docsUrl} target="_blank" rel="noreferrer">
              API docs <ExternalLink />
            </a>
          </Button>
        }
      />
      {!s ? null : (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Bot className="size-4" /> AI provider</CardTitle>
              <CardDescription>Question generation, answer evaluation, reports, resume parsing.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted">Provider</span>
                <span className="font-medium">{s.provider}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted">Model</span>
                <span className="font-medium">{s.model ?? '—'}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted">Status</span>
                <Badge variant={s.configured ? 'success' : 'warning'}>{s.configured ? 'Configured' : 'Offline mock'}</Badge>
              </div>
              <ul className="divide-y border-t pt-1">
                <OnOff on={s.features.questions} label="Interviewer questions" />
                <OnOff on={s.features.evaluation} label="Answer evaluation" />
                <OnOff on={s.features.reports} label="Reports" />
                <OnOff on={s.features.resumeParsing} label="Resume parsing" />
                <OnOff on={s.features.transcription} label="Server transcription" />
                <OnOff on={s.features.speech} label="Server speech synthesis" />
              </ul>
              <p className="text-xs text-muted">
                Configure with <Env>AI_PROVIDER=openai_compatible</Env>, <Env>AI_BASE_URL</Env>, <Env>AI_API_KEY</Env>, <Env>AI_MODEL</Env>. Works with OpenAI, Gemini and DashScope compatible endpoints. Audio needs <Env>AI_ENABLE_AUDIO=true</Env>. Without a key the mock provider produces placeholder output.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Code2 className="size-4" /> Code runner</CardTitle>
              <CardDescription>Sandbox used for the coding section.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted">Runner</span>
                <span className="font-medium">{s.codeRunner.kind}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted">Status</span>
                <Badge variant={s.codeRunner.available ? 'success' : 'danger'}>{s.codeRunner.available ? 'Available' : 'Unavailable'}</Badge>
              </div>
              <div>
                <div className="mb-1 text-xs text-muted">Languages</div>
                <div className="flex flex-wrap gap-1">
                  {s.codeRunner.languages.length ? s.codeRunner.languages.map((l) => <Badge key={l}>{l}</Badge>) : <span className="text-sm text-muted">None</span>}
                </div>
              </div>
              <p className="text-xs text-muted">
                <Env>CODE_RUNNER=docker</Env> runs each submission in an isolated container (needs Docker and pulled images). <Env>CODE_RUNNER=judge0</Env> uses a Judge0 instance via <Env>JUDGE0_URL</Env>. <Env>local</Env> is development-only and unsafe.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Mail className="size-4" /> Email</CardTitle>
              <CardDescription>Invitations, password resets, notifications.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted">Transport</span>
                <span className="font-medium">{s.email.transport}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted">Status</span>
                <Badge variant={s.email.configured ? 'success' : 'warning'}>{s.email.configured ? 'Configured' : 'Incomplete'}</Badge>
              </div>
              <p className="text-xs text-muted">
                <Env>EMAIL_TRANSPORT=smtp</Env> with <Env>SMTP_HOST</Env>, <Env>SMTP_PORT</Env>, <Env>SMTP_USER</Env>, <Env>SMTP_PASS</Env>, <Env>EMAIL_FROM</Env>. The <Env>outbox</Env> transport stores mail in the database for the development mailbox.
              </p>
            </CardContent>
          </Card>
        </div>
      )}
    </>
  );
}
