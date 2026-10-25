import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate } from 'react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, Download, FileText, Laptop, RefreshCw, Trash2, Upload } from 'lucide-react';
import { ChangePasswordBody, UpdateProfileBody, type CandidateProfile, type PublicUser, type ResumeDto, type SessionDto } from '@hws/shared';
import { z } from 'zod';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Dialog, DialogContent, DialogFooter, Field, Input, Skeleton, StatusBadge } from '@/components/ui';
import { api, del, get, logout, patch, post } from '@/lib/api';
import { useAuth } from '@/lib/auth-store';
import { useDocumentTitle } from '@/lib/hooks';
import { errorMessage, qk, queryClient } from '@/lib/query';
import { fmtDate, fmtRelative } from '@/lib/utils';

type Me = PublicUser & { profile: CandidateProfile };
type ProfileValues = z.input<typeof UpdateProfileBody>;
type PasswordValues = z.input<typeof ChangePasswordBody>;

function ProfileForm({ me }: { me: Me }) {
  const setUser = useAuth((s) => s.setUser);
  const form = useForm<ProfileValues>({
    resolver: zodResolver(UpdateProfileBody),
    defaultValues: { name: me.name, username: me.username, headline: me.profile.headline ?? '', location: me.profile.location ?? '', timezone: me.profile.timezone ?? '' },
  });
  const e = form.formState.errors;
  const save = useMutation({
    mutationFn: (v: ProfileValues) => patch<Me>('/users/me', { ...v, headline: v.headline || null, location: v.location || null, timezone: v.timezone || null }),
    onSuccess: (data) => {
      setUser(data);
      queryClient.setQueryData(qk.me, data);
      toast.success('Profile saved');
    },
  });
  return (
    <form onSubmit={form.handleSubmit((v) => save.mutate(v))} className="grid gap-4 sm:grid-cols-2" noValidate>
      <Field label="Full name" htmlFor="name" error={e.name?.message}>
        <Input id="name" {...form.register('name')} />
      </Field>
      <Field label="Username" htmlFor="username" error={e.username?.message}>
        <Input id="username" {...form.register('username')} />
      </Field>
      <Field label="Headline" htmlFor="headline" hint="e.g. Backend engineer, 3 years" error={e.headline?.message} className="sm:col-span-2">
        <Input id="headline" {...form.register('headline')} />
      </Field>
      <Field label="Location" htmlFor="location" error={e.location?.message}>
        <Input id="location" {...form.register('location')} />
      </Field>
      <Field label="Time zone" htmlFor="timezone" hint="e.g. Asia/Kolkata" error={e.timezone?.message}>
        <Input id="timezone" {...form.register('timezone')} />
      </Field>
      <div className="sm:col-span-2">
        <Button type="submit" loading={save.isPending}>
          Save profile
        </Button>
      </div>
    </form>
  );
}

function ResumeSection() {
  const fileRef = useRef<HTMLInputElement>(null);
  const q = useQuery({
    queryKey: qk.resume,
    queryFn: () => get<ResumeDto | null>('/resumes/me'),
    refetchInterval: (query) => (query.state.data && ['pending', 'parsing'].includes(query.state.data.parseStatus) ? 2000 : false),
  });
  const upload = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData();
      fd.append('resume', file);
      return post<ResumeDto>('/resumes', fd);
    },
    onSuccess: () => {
      toast.success('Resume uploaded. Extracting your profile…');
      queryClient.invalidateQueries({ queryKey: qk.resume });
    },
  });
  const reparse = useMutation({ mutationFn: (id: string) => post<ResumeDto>(`/resumes/${id}/reparse`), onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.resume }) });
  const remove = useMutation({
    mutationFn: (id: string) => del(`/resumes/${id}`),
    onSuccess: () => {
      toast.success('Resume deleted');
      queryClient.invalidateQueries({ queryKey: qk.resume });
    },
  });
  const r = q.data;
  const onFile = (f: File | undefined) => {
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) return toast.error('File exceeds 5 MB');
    upload.mutate(f);
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="size-4 text-accent" /> Resume
        </CardTitle>
        <CardDescription>PDF, DOCX or TXT up to 5 MB. The interviewer uses it to ask about your real experience.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <input ref={fileRef} type="file" accept=".pdf,.docx,.txt,application/pdf" className="sr-only" aria-label="Choose resume file" onChange={(e) => onFile(e.target.files?.[0])} />
        {q.isPending ? (
          <Skeleton className="h-16" />
        ) : r ? (
          <div className="rounded-md border p-4 text-sm">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="truncate font-medium">{r.originalName}</div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-muted" aria-live="polite">
                  <StatusBadge status={r.parseStatus} />
                  <span>{(r.sizeBytes / 1024).toFixed(0)} KB · uploaded {fmtRelative(r.createdAt)}</span>
                </div>
                {r.parseError ? <p className="mt-1 text-xs text-danger">{r.parseError}</p> : null}
              </div>
              <div className="flex shrink-0 gap-2">
                <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} loading={upload.isPending}>
                  <Upload /> Replace
                </Button>
                <Button variant="outline" size="sm" onClick={() => reparse.mutate(r.id)} loading={reparse.isPending} disabled={['pending', 'parsing'].includes(r.parseStatus)}>
                  <RefreshCw /> Re-parse
                </Button>
                <Button variant="ghost" size="sm" onClick={() => remove.mutate(r.id)} loading={remove.isPending} aria-label="Delete resume">
                  <Trash2 />
                </Button>
              </div>
            </div>
            {r.profile ? (
              <div className="mt-4 space-y-4 border-t pt-4">
                {r.profile.summary ? <p className="text-muted">{r.profile.summary}</p> : null}
                {r.profile.skills.length ? (
                  <div>
                    <div className="mb-1.5 text-xs font-medium uppercase text-muted">Skills</div>
                    <div className="flex flex-wrap gap-1.5">
                      {r.profile.skills.map((s) => (
                        <span key={s} className="rounded-full bg-surface-2 px-2 py-0.5 text-xs">
                          {s}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}
                {r.profile.experience.length ? (
                  <div>
                    <div className="mb-1.5 text-xs font-medium uppercase text-muted">Experience</div>
                    <ul className="space-y-2">
                      {r.profile.experience.map((x, i) => (
                        <li key={i}>
                          <div className="font-medium">
                            {x.title}
                            {x.company ? ` · ${x.company}` : ''}
                          </div>
                          {x.start || x.end ? (
                            <div className="text-xs text-muted">
                              {x.start}
                              {x.end ? ` – ${x.end}` : ''}
                            </div>
                          ) : null}
                          {x.highlights.length ? <ul className="mt-1 list-disc pl-5 text-muted">{x.highlights.map((h, j) => <li key={j}>{h}</li>)}</ul> : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {r.profile.projects.length ? (
                  <div>
                    <div className="mb-1.5 text-xs font-medium uppercase text-muted">Projects</div>
                    <ul className="space-y-1.5">
                      {r.profile.projects.map((p, i) => (
                        <li key={i}>
                          <span className="font-medium">{p.name}</span>
                          {p.description ? <span className="text-muted"> — {p.description}</span> : null}
                          {p.technologies.length ? <span className="text-xs text-muted"> ({p.technologies.join(', ')})</span> : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {r.profile.education.length ? (
                  <div>
                    <div className="mb-1.5 text-xs font-medium uppercase text-muted">Education</div>
                    <ul className="space-y-1">
                      {r.profile.education.map((ed, i) => (
                        <li key={i}>
                          {ed.institution}
                          {ed.degree ? ` · ${ed.degree}` : ''}
                          {ed.year ? <span className="text-muted"> ({ed.year})</span> : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              onFile(e.dataTransfer.files?.[0]);
            }}
            className="flex w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-8 text-sm text-muted hover:border-accent hover:text-fg cursor-pointer"
          >
            <Upload className="size-6" />
            <span>{upload.isPending ? 'Uploading…' : 'Click or drop a file to upload your resume'}</span>
          </button>
        )}
      </CardContent>
    </Card>
  );
}

function SecuritySection({ email }: { email: string }) {
  const nav = useNavigate();
  const sessions = useQuery({ queryKey: qk.sessions, queryFn: () => get<SessionDto[]>('/auth/sessions') });
  const form = useForm<PasswordValues>({ resolver: zodResolver(ChangePasswordBody), defaultValues: { currentPassword: '', newPassword: '' } });
  const change = useMutation({
    mutationFn: (v: PasswordValues) => post('/auth/change-password', v),
    onSuccess: () => {
      toast.success('Password changed. Please sign in again.');
      logout().then(() => nav('/login'));
    },
  });
  const revoke = useMutation({ mutationFn: (id: string) => del(`/auth/sessions/${id}`), onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.sessions }) });
  const everywhere = useMutation({
    mutationFn: () => post('/auth/logout-all'),
    onSuccess: async () => {
      await logout();
      queryClient.clear();
      nav('/login');
    },
  });
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmEmail, setConfirmEmail] = useState('');
  const destroy = useMutation({
    mutationFn: () => post('/users/me/delete', { confirmEmail }),
    onSuccess: async () => {
      toast.success('Your account and interview data were deleted.');
      await logout();
      queryClient.clear();
      nav('/login');
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Change password</CardTitle>
          <CardDescription>All of your sessions will be signed out afterwards.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={form.handleSubmit((v) => change.mutate(v))} className="grid gap-4 sm:grid-cols-2" noValidate>
            <Field label="Current password" htmlFor="currentPassword" error={form.formState.errors.currentPassword?.message}>
              <Input id="currentPassword" type="password" autoComplete="current-password" {...form.register('currentPassword')} />
            </Field>
            <Field label="New password" htmlFor="newPassword" hint="At least 10 characters." error={form.formState.errors.newPassword?.message}>
              <Input id="newPassword" type="password" autoComplete="new-password" {...form.register('newPassword')} />
            </Field>
            <div className="sm:col-span-2">
              <Button type="submit" variant="outline" loading={change.isPending}>
                Update password
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-start justify-between gap-4">
          <div>
            <CardTitle>Active sessions</CardTitle>
            <CardDescription>Devices currently signed in to your account.</CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={() => everywhere.mutate()} loading={everywhere.isPending}>
            Sign out everywhere
          </Button>
        </CardHeader>
        <CardContent>
          {sessions.isPending ? (
            <Skeleton className="h-12" />
          ) : (
            <ul className="divide-y text-sm">
              {sessions.data?.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="flex min-w-0 items-center gap-3">
                    <Laptop className="size-4 shrink-0 text-muted" />
                    <div className="min-w-0">
                      <div className="truncate">
                        {s.userAgent ?? 'Unknown device'} {s.current ? <span className="ml-1 rounded-full bg-accent/10 px-2 py-0.5 text-xs text-accent">This device</span> : null}
                      </div>
                      <div className="text-xs text-muted">
                        {s.ip ?? '—'} · last used {fmtRelative(s.lastUsedAt)} · signed in {fmtDate(s.createdAt)}
                      </div>
                    </div>
                  </div>
                  {!s.current ? (
                    <Button variant="ghost" size="sm" onClick={() => revoke.mutate(s.id)}>
                      Revoke
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card className="border-danger/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-danger">
            <AlertTriangle className="size-4" /> Delete account
          </CardTitle>
          <CardDescription>Permanently deletes your resume, transcripts, answers, code and reports. Employers keep an anonymised record that an interview took place.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="danger" onClick={() => setConfirmOpen(true)}>
            Delete my account and data
          </Button>
          <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
            <DialogContent title="Delete your account?" description="This cannot be undone. Type your email address to confirm.">
              <Field label="Email" htmlFor="confirmEmail">
                <Input id="confirmEmail" type="email" value={confirmEmail} onChange={(e) => setConfirmEmail(e.target.value)} placeholder={email} />
              </Field>
              <DialogFooter>
                <Button variant="outline" onClick={() => setConfirmOpen(false)}>
                  Cancel
                </Button>
                <Button variant="danger" disabled={confirmEmail.trim().toLowerCase() !== email} loading={destroy.isPending} onClick={() => destroy.mutate()}>
                  Delete permanently
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardContent>
      </Card>
    </div>
  );
}

function DataExportSection() {
  const [busy, setBusy] = useState(false);
  const download = async () => {
    setBusy(true);
    try {
      const res = await api<Response>('/users/me/export', { method: 'GET', raw: true });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = res.headers.get('content-disposition')?.match(/filename="([^"]+)"/)?.[1] ?? 'hirewithsense-export.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success('Your data export has been downloaded.');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>Your data</CardTitle>
        <CardDescription>Download everything HireWithSense holds about you: your profile, resumes, every interview with its questions, answers, code, evaluations and reports, your consent records, and account events. The file is JSON.</CardDescription>
      </CardHeader>
      <CardContent>
        <Button variant="outline" onClick={download} loading={busy}>
          <Download /> Download my data
        </Button>
      </CardContent>
    </Card>
  );
}

export default function ProfilePage() {
  useDocumentTitle('Profile & resume');
  const me = useQuery({ queryKey: qk.me, queryFn: () => get<Me>('/users/me') });
  const [tab, setTab] = useState<'profile' | 'security'>('profile');
  useEffect(() => {
    if (window.location.hash === '#security') setTab('security');
  }, []);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Profile & resume</h1>
          <p className="mt-1 text-sm text-muted">Keep your details current so employers and the interviewer have accurate context.</p>
        </div>
        <div className="inline-flex rounded-md bg-surface-2 p-1 text-sm" role="tablist">
          {(['profile', 'security'] as const).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`rounded-sm px-3 py-1 font-medium capitalize cursor-pointer ${tab === t ? 'bg-surface shadow-xs' : 'text-muted'}`}>
              {t}
            </button>
          ))}
        </div>
      </div>

      {tab === 'profile' ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Your details</CardTitle>
            </CardHeader>
            <CardContent>{me.isPending ? <Skeleton className="h-40" /> : me.data ? <ProfileForm me={me.data} key={me.data.id} /> : <p className="text-sm text-danger">Could not load profile.</p>}</CardContent>
          </Card>
          <ResumeSection />
        </>
      ) : me.data ? (
        <>
          <DataExportSection />
          <SecuritySection email={me.data.email} />
        </>
      ) : (
        <Skeleton className="h-40" />
      )}
    </div>
  );
}
