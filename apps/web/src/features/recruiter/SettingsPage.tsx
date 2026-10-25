import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { z } from 'zod';
import { ChangePasswordBody, CreateOrgInviteBody, UpdateOrganizationBody, type MemberDto, type OrgInviteDto, type OrganizationDto, type SessionDto } from '@hws/shared';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Field, Input, NativeSelect, PageHeader, PageLoader, StatusBadge, Table, Tabs, TabsContent, TabsList, TabsTrigger, Td, Th, Tr } from '@/components/ui';
import { del, get, patch, post } from '@/lib/api';
import { errorMessage, qk, queryClient as globalQc } from '@/lib/query';
import { useAuth } from '@/lib/auth-store';
import { useDocumentTitle } from '@/lib/hooks';
import { fmtDate, fmtRelative } from '@/lib/utils';
import { Alert } from './shared';

type OrgForm = z.infer<typeof UpdateOrganizationBody>;

function OrgProfile({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: qk.org, queryFn: () => get<OrganizationDto>('/orgs/current') });
  const form = useForm<OrgForm>({ resolver: zodResolver(UpdateOrganizationBody) });
  useEffect(() => {
    if (q.data) form.reset({ name: q.data.name, slug: q.data.slug, website: q.data.website, retentionDays: q.data.retentionDays });
  }, [q.data, form]);
  const save = useMutation({
    mutationFn: (v: OrgForm) => patch<OrganizationDto>('/orgs/current', v),
    onSuccess: () => {
      toast.success('Organization updated');
      qc.invalidateQueries({ queryKey: qk.org });
      qc.invalidateQueries({ queryKey: qk.me });
    },
  });
  if (q.isLoading) return <PageLoader />;
  const e = form.formState.errors;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Organization profile</CardTitle>
        <CardDescription>Shown to candidates in invitations and the interview lobby.</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="grid gap-4 sm:grid-cols-2" onSubmit={form.handleSubmit((v) => save.mutate(v))}>
          <Field label="Name" error={e.name?.message} htmlFor="org-name">
            <Input id="org-name" disabled={!canEdit} {...form.register('name')} />
          </Field>
          <Field label="Slug" error={e.slug?.message} hint="Lowercase letters, numbers and dashes" htmlFor="org-slug">
            <Input id="org-slug" disabled={!canEdit} {...form.register('slug')} />
          </Field>
          <Field label="Website" error={e.website?.message} htmlFor="org-web">
            <Input id="org-web" placeholder="https://" disabled={!canEdit} {...form.register('website', { setValueAs: (v) => (v === '' ? null : v) })} />
          </Field>
          <Field label="Data retention (days)" error={e.retentionDays?.message} hint="Interview transcripts, code and reports are purged automatically after this period (30–3650). Candidates can also request deletion at any time." htmlFor="org-ret">
            <Input id="org-ret" type="number" min={30} max={3650} disabled={!canEdit} {...form.register('retentionDays', { valueAsNumber: true })} />
          </Field>
          {canEdit ? (
            <div className="sm:col-span-2 flex justify-end">
              <Button type="submit" loading={save.isPending}>Save changes</Button>
            </div>
          ) : (
            <p className="sm:col-span-2 text-xs text-muted">Only owners and admins can edit the organization.</p>
          )}
        </form>
      </CardContent>
    </Card>
  );
}

function Members({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient();
  const me = useAuth((s) => s.user);
  const members = useQuery({ queryKey: qk.members, queryFn: () => get<MemberDto[]>('/orgs/members') });
  const invites = useQuery({ queryKey: qk.orgInvites, queryFn: () => get<OrgInviteDto[]>('/orgs/invites') });
  const inviteForm = useForm<z.input<typeof CreateOrgInviteBody>, unknown, z.output<typeof CreateOrgInviteBody>>({ resolver: zodResolver(CreateOrgInviteBody), defaultValues: { role: 'member', email: '' } });
  const invite = useMutation({
    mutationFn: (v: z.output<typeof CreateOrgInviteBody>) => post<OrgInviteDto>('/orgs/invites', v),
    onSuccess: () => {
      toast.success('Invitation sent');
      inviteForm.reset({ role: 'member', email: '' });
      qc.invalidateQueries({ queryKey: qk.orgInvites });
    },
  });
  const changeRole = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: 'admin' | 'member' }) => patch(`/orgs/members/${userId}`, { role }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.members }),
  });
  const remove = useMutation({
    mutationFn: (userId: string) => del(`/orgs/members/${userId}`),
    onSuccess: () => {
      toast.success('Member removed');
      qc.invalidateQueries({ queryKey: qk.members });
    },
  });
  const cancelInvite = useMutation({
    mutationFn: (id: string) => del(`/orgs/invites/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.orgInvites }),
  });
  const pending = (invites.data ?? []).filter((i) => !i.acceptedAt);
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Members</CardTitle>
          <CardDescription>Recruiters who can see every job and interview in this organization.</CardDescription>
        </CardHeader>
        <CardContent>
          {members.isLoading ? (
            <PageLoader />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Name</Th>
                  <Th>Email</Th>
                  <Th>Role</Th>
                  <Th>Joined</Th>
                  {canEdit ? <Th /> : null}
                </tr>
              </thead>
              <tbody>
                {(members.data ?? []).map((m) => (
                  <Tr key={m.userId}>
                    <Td className="font-medium">
                      {m.name} {m.userId === me?.id ? <span className="text-xs text-muted">(you)</span> : null}
                    </Td>
                    <Td className="text-muted">{m.email}</Td>
                    <Td>
                      {canEdit && m.role !== 'owner' && m.userId !== me?.id ? (
                        <NativeSelect className="h-8 w-32" value={m.role} onChange={(e) => changeRole.mutate({ userId: m.userId, role: e.target.value as 'admin' | 'member' })} aria-label={`Role of ${m.name}`}>
                          <option value="admin">admin</option>
                          <option value="member">member</option>
                        </NativeSelect>
                      ) : (
                        <StatusBadge status={m.role} />
                      )}
                    </Td>
                    <Td className="text-muted whitespace-nowrap">{fmtDate(m.joinedAt, 'd MMM yyyy')}</Td>
                    {canEdit ? (
                      <Td className="text-right">
                        {m.role !== 'owner' && m.userId !== me?.id ? (
                          <Button variant="ghost" size="sm" className="text-danger" onClick={() => window.confirm(`Remove ${m.name} from the organization?`) && remove.mutate(m.userId)}>
                            Remove
                          </Button>
                        ) : null}
                      </Td>
                    ) : null}
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </CardContent>
      </Card>

      {canEdit ? (
        <Card>
          <CardHeader>
            <CardTitle>Invite a recruiter</CardTitle>
            <CardDescription>They receive an email link to join. Pending invitations expire after 14 days.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <form className="flex flex-col gap-2 sm:flex-row sm:items-end" onSubmit={inviteForm.handleSubmit((v) => invite.mutate(v))}>
              <Field label="Email" className="flex-1" error={inviteForm.formState.errors.email?.message} htmlFor="inv-email">
                <Input id="inv-email" type="email" placeholder="colleague@company.com" {...inviteForm.register('email')} />
              </Field>
              <Field label="Role" htmlFor="inv-role">
                <NativeSelect id="inv-role" className="sm:w-32" {...inviteForm.register('role')}>
                  <option value="member">member</option>
                  <option value="admin">admin</option>
                </NativeSelect>
              </Field>
              <Button type="submit" loading={invite.isPending}>Send invite</Button>
            </form>
            {pending.length ? (
              <Table>
                <thead>
                  <tr>
                    <Th>Email</Th>
                    <Th>Role</Th>
                    <Th>Invited by</Th>
                    <Th>Expires</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody>
                  {pending.map((i) => (
                    <Tr key={i.id}>
                      <Td>{i.email}</Td>
                      <Td><StatusBadge status={i.role} /></Td>
                      <Td className="text-muted">{i.invitedBy}</Td>
                      <Td className="text-muted">{fmtRelative(i.expiresAt)}</Td>
                      <Td className="text-right">
                        <Button variant="ghost" size="sm" onClick={() => cancelInvite.mutate(i.id)}>Cancel</Button>
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            ) : (
              <p className="text-sm text-muted">No pending invitations.</p>
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function Account() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const form = useForm<z.infer<typeof ChangePasswordBody>>({ resolver: zodResolver(ChangePasswordBody) });
  const [done, setDone] = useState(false);
  const change = useMutation({
    mutationFn: (v: z.infer<typeof ChangePasswordBody>) => post('/auth/change-password', v),
    onSuccess: () => {
      setDone(true);
      toast.success('Password changed. Other sessions were signed out.');
      form.reset();
    },
    onError: (err) => toast.error(errorMessage(err)),
    meta: { silent: true },
  });
  const sessions = useQuery({ queryKey: qk.sessions, queryFn: () => get<SessionDto[]>('/auth/sessions') });
  const revoke = useMutation({ mutationFn: (id: string) => del(`/auth/sessions/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: qk.sessions }) });
  const signOutAll = useMutation({
    mutationFn: () => post('/auth/logout-all'),
    onSuccess: () => {
      useAuth.getState().clear();
      globalQc.clear();
      nav('/login');
    },
  });
  const e = form.formState.errors;
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Change password</CardTitle>
          <CardDescription>Use at least 10 characters. Changing it signs you out everywhere else.</CardDescription>
        </CardHeader>
        <CardContent>
          {done ? <Alert tone="success" className="mb-4">Password updated.</Alert> : null}
          <form className="grid max-w-md gap-4" onSubmit={form.handleSubmit((v) => change.mutate(v))}>
            <Field label="Current password" error={e.currentPassword?.message} htmlFor="pw-cur">
              <Input id="pw-cur" type="password" autoComplete="current-password" {...form.register('currentPassword')} />
            </Field>
            <Field label="New password" error={e.newPassword?.message} htmlFor="pw-new">
              <Input id="pw-new" type="password" autoComplete="new-password" {...form.register('newPassword')} />
            </Field>
            <div>
              <Button type="submit" loading={change.isPending}>Update password</Button>
            </div>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="flex-row items-start justify-between">
          <div>
            <CardTitle>Active sessions</CardTitle>
            <CardDescription>Devices currently signed in to your account.</CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={() => signOutAll.mutate()} loading={signOutAll.isPending}>Sign out everywhere</Button>
        </CardHeader>
        <CardContent>
          {sessions.isLoading ? (
            <PageLoader />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Device</Th>
                  <Th>IP</Th>
                  <Th>Last used</Th>
                  <Th>Signed in</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {(sessions.data ?? []).map((s) => (
                  <Tr key={s.id}>
                    <Td className="max-w-[20rem] truncate" title={s.userAgent ?? ''}>
                      {s.userAgent ?? 'Unknown'} {s.current ? <StatusBadge status="accepted" label="this device" className="ml-1" /> : null}
                    </Td>
                    <Td className="text-muted">{s.ip ?? '—'}</Td>
                    <Td className="text-muted whitespace-nowrap">{fmtRelative(s.lastUsedAt)}</Td>
                    <Td className="text-muted whitespace-nowrap">{fmtDate(s.createdAt)}</Td>
                    <Td className="text-right">{!s.current ? <Button variant="ghost" size="sm" onClick={() => revoke.mutate(s.id)}>Revoke</Button> : null}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function SettingsPage() {
  useDocumentTitle('Organization settings');
  const user = useAuth((s) => s.user);
  const canEdit = user?.role === 'superadmin' || user?.organization?.role === 'owner' || user?.organization?.role === 'admin';
  return (
    <>
      <PageHeader title="Organization" description={user?.organization?.name} />
      <Tabs defaultValue="profile">
        <TabsList>
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="members">Members</TabsTrigger>
          <TabsTrigger value="account">My account</TabsTrigger>
        </TabsList>
        <TabsContent value="profile"><OrgProfile canEdit={Boolean(canEdit)} /></TabsContent>
        <TabsContent value="members"><Members canEdit={Boolean(canEdit)} /></TabsContent>
        <TabsContent value="account"><Account /></TabsContent>
      </Tabs>
    </>
  );
}
