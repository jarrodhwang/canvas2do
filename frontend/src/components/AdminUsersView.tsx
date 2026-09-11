import { ChevronLeft, ChevronRight, RefreshCw, Search, ShieldCheck, UserRound, UserX, Eye, Settings } from 'lucide-react';
import { AdminUserDetails } from './AdminUserDetails';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  canvasToDoApi,
  type AdminUser,
  type AdminUserStatus,
} from '../api/canvasToDoApi';
import { cn } from '../lib/utils';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Input } from './ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select';

const statusStyles: Record<AdminUserStatus, string> = {
  active: 'border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200',
  inactive: 'border-zinc-500/35 bg-zinc-500/10 text-zinc-700 dark:text-zinc-200',
  pending: 'border-amber-500/35 bg-amber-500/10 text-amber-700 dark:text-amber-200',
};

function formatDate(value?: string) {
  if (!value) {
    return 'Never';
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || '?';
}

export function AdminUsersView() {
  const [selectedUser, setSelectedUser] = useState<{ id: string; preview: boolean } | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const requestSequence = useRef(0);

  const refresh = useCallback(async () => {
    const sequence = ++requestSequence.current;
    setIsLoading(true);
    setError('');
    try {
      const result = await canvasToDoApi.getAdminUsers({ page, pageSize: 50, search: query });

      if (sequence !== requestSequence.current) {
        return;
      }

      setUsers(result.users ?? []);
      setTotal(result.total ?? 0);
    } catch (loadError) {
      if (sequence === requestSequence.current) {
        setError(loadError instanceof Error ? loadError.message : 'Unable to load users.');
      }
    } finally {
      if (sequence === requestSequence.current) {
        setIsLoading(false);
      }
    }
  }, [page, query]);

  useEffect(() => {
    const timeout = window.setTimeout(() => void refresh(), 250);

    return () => window.clearTimeout(timeout);
  }, [refresh]);

  const pageCount = Math.max(1, Math.ceil(total / 50));

  const updateUser = async (user: AdminUser, update: { role?: string; status?: AdminUserStatus }) => {
    const currentRole = user.role?.toLowerCase() === 'admin' ? 'Admin' : 'User';
    const changes = [
      update.role && update.role !== currentRole
        ? `role from ${currentRole} to ${update.role}`
        : null,
      update.status && update.status !== user.status
        ? `status from ${user.status} to ${update.status}`
        : null,
    ].filter(Boolean);

    if (changes.length === 0 || !window.confirm(
      `Change ${user.displayName || user.email}'s ${changes.join(' and ')}?`,
    )) {
      return;
    }

    setBusyUserId(user.id);
    setError('');
    setMessage('');
    try {
      const updated = await canvasToDoApi.updateAdminUser(user.id, update);
      setUsers((current) => current.map((item) => item.id === updated.id ? { ...item, ...updated } : item));
      setMessage(`${updated.displayName || user.displayName} was updated.`);
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'Unable to update this user.');
    } finally {
      setBusyUserId(null);
    }
  };

  const revokeSessions = async (user: AdminUser) => {
    if (!window.confirm(
      `Revoke every active session for ${user.displayName || user.email}? They will need to sign in again.`,
    )) {
      return;
    }

    setBusyUserId(user.id);
    setError('');
    setMessage('');
    try {
      await canvasToDoApi.signOutAdminUser(user.id);
      setMessage(`Active sessions for ${user.displayName} were revoked.`);
    } catch (revokeError) {
      setError(revokeError instanceof Error ? revokeError.message : 'Unable to revoke sessions.');
    } finally {
      setBusyUserId(null);
    }
  };

  if (selectedUser) return <AdminUserDetails key={selectedUser.id} userId={selectedUser.id} preview={selectedUser.preview}
    onClose={() => { setSelectedUser(null); void refresh(); }} onSaved={() => void refresh()} />;

  return (
    <Card className="min-w-0 rounded-xl bg-card shadow-none max-[520px]:gap-2 max-[520px]:py-2">
      <CardHeader className="gap-3 border-b md:flex-row md:items-center md:justify-between max-[520px]:flex max-[520px]:flex-row max-[520px]:items-center max-[520px]:gap-2 max-[520px]:px-3">
        <div>
          <ShieldCheck aria-hidden="true" className="hidden size-5 text-muted-foreground max-[520px]:block" />
          <CardTitle className="text-xl font-black max-[520px]:sr-only">User management</CardTitle>
          <p className="mt-1 text-sm font-semibold text-muted-foreground max-[520px]:hidden">
            Manage profiles, account settings, Canvas connections, and password approvals.
          </p>
        </div>
        <div className="flex items-center gap-2 max-[520px]:min-w-0 max-[520px]:flex-1">
          <label className="relative min-w-0 max-[520px]:flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label="Search users"
              className="w-[240px] max-w-[55vw] pl-9 max-[520px]:h-11 max-[520px]:w-full max-[520px]:max-w-full"
              onChange={(event) => {
                setPage(1);
                setQuery(event.target.value);
              }}
              placeholder="Search users"
              value={query}
            />
          </label>
          <Button aria-label="Refresh users" className="max-[520px]:size-11" disabled={isLoading} onClick={() => void refresh()} size="icon" variant="outline">
            <RefreshCw className={cn('size-4', isLoading && 'animate-spin')} />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {error || message ? (
          <div className={cn(
            'border-b px-4 py-2 text-sm font-semibold',
            error ? 'border-destructive/25 bg-destructive/10 text-destructive' : 'border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200',
          )}>
            {error || message}
          </div>
        ) : null}
        <div className="divide-y">
          {!isLoading && users.length === 0 ? (
            <div className="p-8 text-center text-sm font-semibold text-muted-foreground">No users found.</div>
          ) : null}
          {users.map((user) => {
            const busy = busyUserId === user.id;
            const role = user.role?.toLowerCase() === 'admin' ? 'Admin' : 'User';

            return (
              <div className="grid gap-4 p-4 max-[520px]:grid-cols-2 max-[520px]:gap-2 max-[520px]:p-3 lg:grid-cols-[minmax(220px,1fr)_150px_150px] lg:items-center" key={user.id}>
                <div className="flex min-w-0 items-center gap-3 max-[520px]:col-span-2 max-[520px]:gap-2">
                  <span className="grid size-10 max-[520px]:size-8 shrink-0 place-items-center overflow-hidden rounded-full bg-primary/10 text-sm font-black text-primary">
                    {initials(user.displayName)}
                  </span>
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate font-black">{user.displayName}</span>
                      {user.twoFactorEnabled ? <ShieldCheck aria-label="Two-step verification enabled" className="size-4 shrink-0 text-emerald-600" /> : null}
                    </div>
                    <div className="truncate text-xs font-semibold text-muted-foreground">{user.email}</div>
                    {user.passwordRequest?.status === 'pending' && <div className="text-xs font-bold text-amber-700 dark:text-amber-200">Password change awaiting approval</div>}
                    {!user.emailConfirmed ? (
                      <div className="mt-0.5 text-[11px] font-bold text-amber-700 dark:text-amber-200">Email not confirmed</div>
                    ) : null}
                    <div className="mt-0.5 text-[11px] font-semibold text-muted-foreground">Last sign-in: {formatDate(user.lastLoginAt)}</div>
                  </div>
                </div>
                <Select
                  disabled={busy}
                  onValueChange={(value) => void updateUser(user, { role: value })}
                  value={role}
                >
                  <SelectTrigger className="max-[520px]:h-11 max-[520px]:w-full max-[520px]:min-w-0 max-[520px]:text-xs" aria-label={`Role for ${user.displayName}`}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="User"><span className="inline-flex items-center gap-2"><UserRound className="size-4" /> User</span></SelectItem>
                    <SelectItem value="Admin"><span className="inline-flex items-center gap-2"><ShieldCheck className="size-4" /> Admin</span></SelectItem>
                  </SelectContent>
                </Select>
                <Select
                  disabled={busy}
                  onValueChange={(value) => void updateUser(user, { status: value as AdminUserStatus })}
                  value={user.status}
                >
                  <SelectTrigger className={cn("max-[520px]:h-11 max-[520px]:w-full max-[520px]:min-w-0 max-[520px]:text-xs", statusStyles[user.status])} aria-label={`Status for ${user.displayName}`}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="pending">Pending approval</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                  </SelectContent>
                </Select>
                <div className="flex flex-wrap items-center justify-end gap-2 lg:col-span-3 max-[520px]:col-span-2 max-[520px]:gap-1.5">
                  <Button className="max-[520px]:h-11 max-[520px]:flex-1 max-[520px]:px-2 max-[520px]:text-xs" size="sm" variant="outline" onClick={() => setSelectedUser({ id: user.id, preview: false })}><Settings className="size-4" /> Details</Button>
                  <Button className="max-[520px]:h-11 max-[520px]:flex-1 max-[520px]:px-2 max-[520px]:text-xs" size="sm" variant="outline" onClick={() => setSelectedUser({ id: user.id, preview: true })}><Eye className="size-4" /> Preview</Button>
                  {user.status === 'pending' ? (
                    <Button
                      disabled={busy}
                      onClick={() => void updateUser(user, { status: 'active' })}
                      size="sm"
                      type="button"
                    >
                      <ShieldCheck className="size-4" /> Approve
                    </Button>
                  ) : null}
                  <Badge className={cn(statusStyles[user.status], "max-[520px]:hidden")} variant="outline">{user.status}</Badge>
                  <Button
                    className="max-[520px]:size-11 max-[520px]:shrink-0"
                    aria-label={`Revoke sessions for ${user.displayName}`}
                    disabled={busy}
                    onClick={() => void revokeSessions(user)}
                    size="icon"
                    title="Revoke active sessions"
                    variant="outline"
                  >
                    <UserX className="size-4" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
        {total > 0 ? (
          <div className="flex items-center justify-between gap-3 border-t px-4 py-3 max-[520px]:px-3 max-[520px]:py-2 text-xs font-semibold text-muted-foreground">
            <span>{total} user{total === 1 ? '' : 's'}</span>
            <div className="flex items-center gap-2">
              <Button
                aria-label="Previous user page"
                disabled={isLoading || page <= 1}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                size="icon"
                variant="outline"
              >
                <ChevronLeft className="size-4" />
              </Button>
              <span>Page {page} of {pageCount}</span>
              <Button
                aria-label="Next user page"
                disabled={isLoading || page >= pageCount}
                onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
                size="icon"
                variant="outline"
              >
                <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
