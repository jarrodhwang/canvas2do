import { ChevronLeft, ChevronRight, RefreshCw, Search, ShieldCheck, UserRound, UserX, Eye, Settings, MoreHorizontal } from 'lucide-react';
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
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
  const [selectedUser, setSelectedUser] = useState<{ id: string; preview: boolean; initialTab?: 'password' | 'canvas' } | null>(null);
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

  if (selectedUser) return <AdminUserDetails key={selectedUser.id} userId={selectedUser.id} preview={selectedUser.preview} initialTab={selectedUser.initialTab}
    onClose={() => { setSelectedUser(null); void refresh(); }} onSaved={() => void refresh()} />;

  return (
    <Card className="min-w-0 gap-0 overflow-hidden rounded-xl bg-card py-0 shadow-none">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 border-b px-4 py-3 max-[520px]:flex-nowrap max-[520px]:gap-2 max-[520px]:px-3 max-[520px]:py-2">
        <div className="flex shrink-0 items-center gap-2">
          <ShieldCheck aria-hidden="true" className="size-4 text-muted-foreground" />
          <CardTitle className="text-base font-semibold max-[520px]:sr-only">User management</CardTitle>
          <Badge className="h-5 px-1.5 text-[11px] tabular-nums" variant="secondary" aria-label={`${total} users`}>{total}</Badge>
        </div>
        <div className="flex items-center gap-2 max-[520px]:min-w-0 max-[520px]:flex-1">
          <label className="relative min-w-0 max-[520px]:flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label="Search users"
              className="h-8 w-[230px] max-w-[55vw] text-sm pl-9 max-[520px]:h-11 max-[520px]:w-full max-[520px]:max-w-full"
              onChange={(event) => {
                setPage(1);
                setQuery(event.target.value);
              }}
              placeholder="Search users"
              value={query}
            />
          </label>
          <Button aria-label="Refresh users" className="size-8 shrink-0 max-[520px]:size-11" disabled={isLoading} onClick={() => void refresh()} size="icon" variant="outline">
            <RefreshCw className={cn('size-4', isLoading && 'animate-spin')} />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {error || message ? (
          <div role={error ? 'alert' : 'status'} className={cn(
            'border-b px-4 py-2 text-sm font-semibold',
            error ? 'border-destructive/25 bg-destructive/10 text-destructive' : 'border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200',
          )}>
            {error || message}
          </div>
        ) : null}
        <div aria-hidden="true" className="hidden grid-cols-[minmax(220px,1fr)_230px_180px_80px] gap-4 border-b bg-muted/25 px-4 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground xl:grid">
          <span>User</span><span>Role / status</span><span>Activity</span><span className="text-right">Actions</span>
        </div>
        {isLoading && users.length === 0 ? <p role="status" className="px-4 py-6 text-center text-sm text-muted-foreground">Loading users…</p> : null}
        {!isLoading && users.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">{error ? 'User list unavailable. Try refreshing.' : query ? 'No users match your search.' : 'No users found.'}</p>
        ) : null}
        <ul aria-label="Users" aria-busy={isLoading} className="divide-y">
          {users.map((user) => {
            const busy = busyUserId === user.id;
            const role = user.role?.toLowerCase() === 'admin' ? 'Admin' : 'User';
            const label = user.displayName || user.email;
            const openDetails = () => setSelectedUser({ id: user.id, preview: false });

            return (
              <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-4 py-3 max-[520px]:px-3 xl:grid-cols-[minmax(220px,1fr)_230px_180px_80px] xl:gap-4 xl:py-2.5" key={user.id}>
                <div className="col-start-1 row-start-1 flex min-w-0 items-start gap-2.5">
                  <span aria-hidden="true" className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
                    {initials(label)}
                  </span>
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <button className="min-w-0 truncate rounded-sm text-left text-sm font-semibold hover:underline focus-visible:outline-2 focus-visible:outline-ring" aria-label={`View details for ${label}`} title={label} onClick={openDetails} type="button">{label}</button>
                      {user.twoFactorEnabled ? <ShieldCheck aria-label="Two-step verification enabled" className="size-3.5 shrink-0 text-emerald-600" /> : null}
                    </div>
                    <div className="truncate text-xs text-muted-foreground" title={user.email}>{user.email}</div>
                    {(user.manualModeRequestPending || user.passwordRequest?.status === 'pending' || !user.emailConfirmed) && (
                      <div className="mt-1 flex flex-wrap items-center gap-1">
                        {user.manualModeRequestPending && <button className="rounded border border-amber-500/25 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 hover:bg-amber-500/20 focus-visible:outline-2 focus-visible:outline-ring dark:text-amber-200" onClick={() => setSelectedUser({ id: user.id, preview: false, initialTab: 'canvas' })} type="button" aria-label={`Review manual mode request for ${label}`}>Manual mode approval</button>}
                        {user.passwordRequest?.status === 'pending' && <button className="rounded border border-amber-500/25 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 hover:bg-amber-500/20 focus-visible:outline-2 focus-visible:outline-ring dark:text-amber-200" onClick={() => setSelectedUser({ id: user.id, preview: false, initialTab: 'password' })} type="button" aria-label={`Review password request for ${label}`}>Password approval</button>}
                        {!user.emailConfirmed && <span className="text-[10px] text-amber-700 dark:text-amber-200">Email unconfirmed</span>}
                      </div>
                    )}
                  </div>
                </div>
                <div className="col-span-2 col-start-1 row-start-2 grid min-w-0 grid-cols-2 gap-2 xl:col-span-1 xl:col-start-2 xl:row-start-1">
                  <Select disabled={busy} onValueChange={(value) => void updateUser(user, { role: value })} value={role}>
                    <SelectTrigger className="h-8 w-full min-w-0 text-xs max-[520px]:h-11" aria-label={`Role for ${label}`}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="User"><span className="inline-flex items-center gap-2"><UserRound className="size-4" /> User</span></SelectItem>
                      <SelectItem value="Admin"><span className="inline-flex items-center gap-2"><ShieldCheck className="size-4" /> Admin</span></SelectItem>
                    </SelectContent>
                  </Select>
                  <Select disabled={busy} onValueChange={(value) => void updateUser(user, { status: value as AdminUserStatus })} value={user.status}>
                    <SelectTrigger className={cn('h-8 w-full min-w-0 text-xs max-[520px]:h-11', statusStyles[user.status])} aria-label={`Status for ${label}`}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="pending">Pending</SelectItem>
                      <SelectItem value="inactive">Inactive</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <dl className="col-span-2 col-start-1 row-start-3 flex min-w-0 flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-muted-foreground xl:col-span-1 xl:col-start-3 xl:row-start-1 xl:block xl:space-y-1">
                  <div title="Latest authenticated app request, recorded at most once per minute. Times are local."><dt className="inline">Active: </dt><dd className="inline text-foreground/80">{user.lastActiveAt ? formatDate(user.lastActiveAt) : 'Not recorded'}</dd></div>
                  <div><dt className="inline">Sign-in: </dt><dd className="inline">{formatDate(user.lastLoginAt)}</dd></div>
                </dl>
                <div className="col-start-2 row-start-1 flex items-center justify-end gap-1 self-start xl:col-start-4 xl:self-center">
                  <Button className="size-8 max-[520px]:size-11" size="icon" variant="ghost" aria-label={`Manage ${label}`} title="Account details" onClick={openDetails}><Settings className="size-4" /></Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button className="size-8 max-[520px]:size-11" size="icon" variant="ghost" disabled={busy} aria-label={`Actions for ${label}`} title="More actions"><MoreHorizontal className="size-4" /></Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-56" aria-label={`Actions for ${label}`}>
                      <div aria-hidden="true" className="truncate px-2 py-1.5 text-xs font-semibold text-muted-foreground">{label}</div>
                      <DropdownMenuItem onSelect={openDetails}><Settings className="size-4" />Account details</DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => setSelectedUser({ id: user.id, preview: true })}><Eye className="size-4" />Preview account</DropdownMenuItem>
                      {user.status === 'pending' && <DropdownMenuItem disabled={busy} onSelect={() => void updateUser(user, { status: 'active' })}><ShieldCheck className="size-4" />Approve account</DropdownMenuItem>}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem variant="destructive" disabled={busy} onSelect={() => void revokeSessions(user)}><UserX className="size-4" />Revoke sessions</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </li>
            );
          })}
        </ul>
        {total > 0 ? (
          <div className="flex items-center justify-between gap-3 border-t px-4 py-2 max-[520px]:px-3 text-xs font-semibold text-muted-foreground">
            <span>{users.length ? (page - 1) * 50 + 1 : 0}–{Math.min(page * 50, total)} of {total}</span>
            <div className="flex items-center gap-2">
              <Button
                aria-label="Previous user page"
                className="size-7 max-[520px]:size-11"
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
                className="size-7 max-[520px]:size-11"
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
