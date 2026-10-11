// web-43 User management. GET /v1/users; PATCH /v1/users/{id} {expected_version, role?, store_ids?,
// active?} (self-lockout 403, last-admin 409 last_admin, stale version 409); revoke sessions;
// password reset link (shown once); reset MFA; pending invitations with revoke.
import '../styles/group-d.css';
import { useMemo, useState, type FormEvent } from 'react';
import type { ApiError } from '../api/client';
import { endpoints } from '../api/endpoints';
import { useApiQuery, useMutation, usePagedQuery } from '../api/hooks';
import type { Role, User } from '../api/types';
import { gd, type InvitationRow } from '../components/groupd/api';
import { apiErrorText, isVersionConflict } from '../components/groupd/errors';
import { OnceSecret, RoleLabel, ROLES, StoreMultiSelect, StoreNames } from '../components/groupd/ui';
import { DataTable, type Column } from '../components/DataTable';
import { Select, SelectField, TextInput, Toggle } from '../components/forms';
import { ConfirmDialog, Modal } from '../components/Modal';
import { PageHeader } from '../components/PageHeader';
import { Badge, Button, ButtonLink, Card, Notice, StatusPill } from '../components/primitives';
import { ConflictBanner, EmptyState, PermissionDenied } from '../components/states';
import { useI18n } from '../i18n';
import { screenPath } from '../routes.meta';
import { useSession } from '../session/SessionProvider';

type Dialog =
  | { kind: 'edit'; user: User }
  | { kind: 'sessions'; user: User }
  | { kind: 'reset'; user: User }
  | { kind: 'mfa'; user: User }
  | { kind: 'revokeInvite'; invite: InvitationRow }
  | null;

export default function UsersPage() {
  const { t, fmt, locale } = useI18n();
  const { can, me, timeZone } = useSession();
  const tz = me?.org.timezone ?? timeZone;
  const users = usePagedQuery((_c, signal) => endpoints.users.list({}, { signal }), [], { enabled: can('user.manage') });
  const invites = useApiQuery((signal) => gd.users.invitations({ signal }), [], { enabled: can('user.manage') });
  const [dialog, setDialog] = useState<Dialog>(null);
  const [resetLink, setResetLink] = useState<{ user: User; url: string; expires_at: string } | null>(null);
  const [conflict, setConflict] = useState(false);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<'' | Role>('');
  const [activeFilter, setActiveFilter] = useState<'all' | 'active' | 'inactive'>('all');

  const close = () => setDialog(null);

  const revokeSessions = useMutation((u: User) => endpoints.users.revokeSessions(u.id), {
    successMessage: t('All sessions for this user were signed out'),
  });
  const resetMfa = useMutation((u: User) => gd.users.resetMfa(u.id), {
    successMessage: t('Two-step verification was reset. The user enrolls again at next sign-in.'),
    onSuccess: () => users.reload(),
    onError: (e) => e.status === 403,
  });
  const issueReset = useMutation((u: User) => endpoints.users.passwordResetLink(u.id), {
    successMessage: t('Password reset link issued'),
    onSuccess: (r) => {
      if (dialog?.kind === 'reset') setResetLink({ user: dialog.user, url: r.reset_url, expires_at: r.expires_at });
    },
  });
  const revokeInvite = useMutation((i: InvitationRow) => endpoints.users.revokeInvitation(i.id), {
    successMessage: t('Invitation revoked'),
    onSuccess: () => invites.reload(),
  });

  const q = search.trim().toLowerCase();
  const filterRows = (u: User) =>
    (!q || u.display_name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)) &&
    (!roleFilter || u.role === roleFilter) &&
    (activeFilter === 'all' || (activeFilter === 'active' ? u.active : !u.active));

  const columns: Column<User>[] = [
    {
      key: 'user',
      header: t('User'),
      primary: true,
      render: (u) => (
        <span>
          <strong>{u.display_name}</strong>
          {u.id === me?.user.id ? (
            <>
              {' '}
              <Badge tone="info">{t('You')}</Badge>
            </>
          ) : null}
          <div className="muted small">{u.email}</div>
        </span>
      ),
    },
    { key: 'role', header: t('Role'), render: (u) => <RoleLabel role={u.role} /> },
    {
      key: 'stores',
      header: t('Store scope'),
      render: (u) => (u.role === 'org_admin' ? <span>{t('All stores (organization admin)')}</span> : <StoreNames ids={u.store_ids} allLabel={t('No stores')} />),
    },
    {
      key: 'mfa',
      header: t('MFA'),
      render: (u) => (u.mfa_enabled ? <StatusPill tone="ok">{t('Enrolled')}</StatusPill> : <StatusPill tone="warning">{t('Not set up')}</StatusPill>),
    },
    {
      key: 'last',
      header: t('Last sign-in'),
      render: (u) =>
        u.last_sign_in_at ? (
          <span title={fmt.dateTime(u.last_sign_in_at, tz, { withZone: true })}>{fmt.dateTime(u.last_sign_in_at, tz, { seconds: false })}</span>
        ) : (
          <span className="muted">{t('Never')}</span>
        ),
    },
    {
      key: 'active',
      header: t('Account'),
      render: (u) => (u.active ? <StatusPill tone="ok">{t('Active')}</StatusPill> : <StatusPill tone="neutral">{t('Inactive')}</StatusPill>),
    },
    {
      key: 'actions',
      header: t('Actions'),
      render: (u) => (
        <div className="gd-row-actions">
          <Button size="sm" variant="secondary" onClick={() => setDialog({ kind: 'edit', user: u })} aria-label={t('Edit {name}', { name: u.display_name })}>
            {t('Edit')}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setDialog({ kind: 'reset', user: u })} aria-label={t('Issue password reset link for {name}', { name: u.display_name })}>
            {t('Reset link')}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setDialog({ kind: 'sessions', user: u })} aria-label={t('Revoke sessions for {name}', { name: u.display_name })}>
            {t('Revoke sessions')}
          </Button>
          {u.id !== me?.user.id && u.mfa_enabled ? (
            <Button size="sm" variant="ghost" onClick={() => setDialog({ kind: 'mfa', user: u })} aria-label={t('Reset two-step verification for {name}', { name: u.display_name })}>
              {t('Reset MFA')}
            </Button>
          ) : null}
        </div>
      ),
    },
  ];

  if (!can('user.manage')) {
    return (
      <>
        <PageHeader screenId="web-43" />
        <PermissionDenied permission="user.manage" />
      </>
    );
  }

  return (
    <>
      <PageHeader
        screenId="web-43"
        action={
          <>
            <ButtonLink to={screenPath('web-45')} variant="secondary">
              {t('Roles & permissions')}
            </ButtonLink>
            <ButtonLink to={screenPath('web-44')} variant="primary">
              {t('Invite a teammate')}
            </ButtonLink>
          </>
        }
      />
      {conflict ? (
        <ConflictBanner
          onReload={() => {
            setConflict(false);
            users.reload();
          }}
        />
      ) : null}
      <div className="card">
        <DataTable
          caption={t('Users')}
          query={users}
          columns={columns}
          rowKey={(u) => u.id}
          filterRows={filterRows}
          toolbar={
            <>
              <label className="filter gd-filter-grow">
                <span className="filter-label">{t('Search by name or email')}</span>
                <TextInput type="search" value={search} onChange={(e) => setSearch(e.target.value)} />
              </label>
              <label className="filter">
                <span className="filter-label">{t('Role')}</span>
                <Select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value as '' | Role)}>
                  <option value="">{t('All roles')}</option>
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {t(`role|${r}`)}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="filter">
                <span className="filter-label">{t('Account')}</span>
                <Select value={activeFilter} onChange={(e) => setActiveFilter(e.target.value as 'all' | 'active' | 'inactive')}>
                  <option value="all">{t('All accounts')}</option>
                  <option value="active">{t('Active')}</option>
                  <option value="inactive">{t('Inactive')}</option>
                </Select>
              </label>
            </>
          }
          empty={<EmptyState compact icon="users" title={q || roleFilter || activeFilter !== 'all' ? t('No users match these filters') : t('No users yet')} />}
        />
      </div>

      <Card title={t('Pending invitations')} className="gd-section">
        {invites.error && !invites.data ? (
          <p className="field-error" role="alert">
            {apiErrorText(invites.error, locale)}{' '}
            <Button size="sm" variant="secondary" onClick={invites.reload}>
              {t('Retry')}
            </Button>
          </p>
        ) : !invites.data ? (
          <p className="muted">{t('Loading…')}</p>
        ) : invites.data.items.length === 0 ? (
          <p className="muted">{t('No pending invitations.')}</p>
        ) : (
          <ul className="rows">
            {invites.data.items.map((i) => (
              <li className="row" key={i.id}>
                <div className="row-main">
                  <strong>{i.email}</strong> · <RoleLabel role={i.role} />
                  <div className="muted small">
                    {i.role === 'org_admin' ? t('All stores (organization admin)') : <StoreNames ids={i.store_ids} />} ·{' '}
                    {t('Expires {date}', { date: fmt.dateTime(i.expires_at, tz, { seconds: false, withZone: true }) })}
                  </div>
                </div>
                <Button size="sm" variant="secondary" onClick={() => setDialog({ kind: 'revokeInvite', invite: i })} aria-label={t('Revoke invitation for {email}', { email: i.email })}>
                  {t('Revoke')}
                </Button>
              </li>
            ))}
          </ul>
        )}
        <p className="muted small">{t('Invitation links are shown once when created. Email delivery is not configured.')}</p>
      </Card>

      {dialog?.kind === 'edit' ? (
        <EditUser
          user={dialog.user}
          self={dialog.user.id === me?.user.id}
          onClose={close}
          onSaved={(u) => users.setItems((xs) => xs.map((x) => (x.id === u.id ? u : x)))}
          onConflict={() => {
            close();
            setConflict(true);
            users.reload();
          }}
        />
      ) : null}
      <ConfirmDialog
        open={dialog?.kind === 'sessions'}
        onClose={close}
        title={t('Revoke sessions')}
        description={dialog?.kind === 'sessions' ? t('{name} is signed out on every browser and device, and push registrations are removed.', { name: dialog.user.display_name }) : undefined}
        confirmLabel={t('Revoke sessions')}
        confirmVariant="danger"
        requireReason={false}
        pending={revokeSessions.pending}
        onConfirm={async () => (dialog?.kind === 'sessions' ? (await revokeSessions.run(dialog.user)).ok : false)}
      />
      <ConfirmDialog
        open={dialog?.kind === 'mfa'}
        onClose={() => {
          close();
          resetMfa.reset();
        }}
        title={t('Reset MFA')}
        description={dialog?.kind === 'mfa' ? t('{name} must set up two-step verification again at the next sign-in. Their sessions are signed out.', { name: dialog.user.display_name }) : undefined}
        confirmLabel={t('Reset MFA')}
        confirmVariant="danger"
        requireReason={false}
        pending={resetMfa.pending}
        error={resetMfa.error ? apiErrorText(resetMfa.error, locale) : null}
        onConfirm={async () => (dialog?.kind === 'mfa' ? (await resetMfa.run(dialog.user)).ok : false)}
      />
      <ConfirmDialog
        open={dialog?.kind === 'revokeInvite'}
        onClose={close}
        title={t('Revoke invitation')}
        description={dialog?.kind === 'revokeInvite' ? t('The invitation link for {email} stops working immediately.', { email: dialog.invite.email }) : undefined}
        confirmLabel={t('Revoke')}
        confirmVariant="danger"
        requireReason={false}
        pending={revokeInvite.pending}
        onConfirm={async () => (dialog?.kind === 'revokeInvite' ? (await revokeInvite.run(dialog.invite)).ok : false)}
      />
      <Modal
        open={dialog?.kind === 'reset'}
        onClose={() => {
          close();
          setResetLink(null);
        }}
        title={t('Password reset link')}
        description={dialog?.kind === 'reset' ? t('Issue a one-time link for {name}. It expires after 24 hours and replaces earlier links.', { name: dialog.user.display_name }) : undefined}
        footer={
          resetLink ? (
            <Button
              onClick={() => {
                close();
                setResetLink(null);
              }}
            >
              {t('Done')}
            </Button>
          ) : (
            <>
              <Button variant="secondary" onClick={close}>
                {t('Cancel')}
              </Button>
              <Button pending={issueReset.pending} onClick={() => dialog?.kind === 'reset' && void issueReset.run(dialog.user)}>
                {t('Issue link')}
              </Button>
            </>
          )
        }
      >
        {resetLink ? (
          <OnceSecret
            label={t('Reset link for {name}', { name: resetLink.user.display_name })}
            value={resetLink.url}
            note={
              <>
                {t('Expires {date}', { date: fmt.dateTime(resetLink.expires_at, tz, { seconds: false, withZone: true }) })}.{' '}
                {t('Deliver it through an approved channel. Email delivery is not configured.')}
              </>
            }
          />
        ) : (
          <Notice tone="info">{t('The link is shown only once. Share it with the person through an approved channel.')}</Notice>
        )}
      </Modal>
    </>
  );
}

function EditUser({
  user,
  self,
  onClose,
  onSaved,
  onConflict,
}: {
  user: User;
  self: boolean;
  onClose: () => void;
  onSaved: (u: User) => void;
  onConflict: () => void;
}) {
  const { t, locale } = useI18n();
  const [role, setRole] = useState<Role>(user.role);
  const [storeIds, setStoreIds] = useState<string[]>(user.store_ids);
  const [active, setActive] = useState(user.active);
  const [error, setError] = useState<string | null>(null);

  const save = useMutation((body: { expected_version: number; role?: Role; store_ids?: string[]; active?: boolean }) => endpoints.users.update(user.id, body), {
    successMessage: t('User updated'),
    onSuccess: (u) => {
      onSaved(u);
      onClose();
    },
    onError: (e: ApiError) => {
      if (isVersionConflict(e)) {
        onConflict();
        return true;
      }
      setError(apiErrorText(e, locale));
      return true;
    },
  });
  const sameStores = useMemo(() => [...storeIds].sort().join(',') === [...user.store_ids].sort().join(','), [storeIds, user.store_ids]);

  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    setError(null);
    if (role !== 'org_admin' && storeIds.length === 0 && active) {
      setError(t('Assign at least one store. Without stores this person cannot see any records.'));
      return;
    }
    const body: { expected_version: number; role?: Role; store_ids?: string[]; active?: boolean } = { expected_version: user.version };
    if (role !== user.role) body.role = role;
    if (!sameStores) body.store_ids = storeIds;
    if (active !== user.active) body.active = active;
    if (Object.keys(body).length === 1) {
      onClose();
      return;
    }
    void save.run(body);
  };

  return (
    <Modal open onClose={onClose} title={t('Edit {name}', { name: user.display_name })} description={user.email} size="md" dismissible={!save.pending}>
      <form onSubmit={submit} noValidate>
        {self ? <Notice tone="info">{t('You cannot change your own role or deactivate yourself. Ask another administrator.')}</Notice> : null}
        {!self ? (
          <SelectField label={t('Role')} value={role} onChange={(e) => setRole(e.target.value as Role)} options={ROLES.map((r) => ({ value: r, label: t(`role|${r}`) }))} hint={t('Role changes sign the person out so new permissions apply immediately.')} />
        ) : null}
        {role === 'org_admin' ? (
          <p className="muted small">{t('Organization admins can access every store.')}</p>
        ) : (
          <StoreMultiSelect label={t('Store scope')} value={storeIds} onChange={setStoreIds} hint={t('The person sees records only for these stores.')} />
        )}
        {!self ? (
          <Toggle label={t('Account active')} checked={active} onChange={setActive} hint={t('Deactivating signs the person out and blocks sign-in. Records they created remain.')} />
        ) : null}
        {error ? (
          <div className="field-error" role="alert">
            {error}
          </div>
        ) : null}
        <p className="muted small">{t('Version {n}', { n: user.version })}</p>
        <div className="modal-foot">
          <Button variant="secondary" onClick={onClose} disabled={save.pending}>
            {t('Cancel')}
          </Button>
          <Button type="submit" pending={save.pending}>
            {t('Save changes')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
