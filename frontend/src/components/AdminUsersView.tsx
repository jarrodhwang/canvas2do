import { CheckCircle2, KeyRound, Loader2, Mail, RefreshCw, UserCheck, UserX } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';

import {
  workspaceApi,
  type AdminGroup,
  type AdminUser,
  type AdminUserStatus,
  type CanvasTokenStatus,
  type UpdateAdminUserRequest,
} from '../api/workspaceApi';
import { cn } from '../lib/utils';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { DateTimeField } from './DateTimeField';

const statusStyles: Record<AdminUserStatus, string> = {
  active: 'border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200',
  pending: 'border-yellow-500/45 bg-yellow-400/20 text-yellow-800 dark:text-yellow-100',
  inactive: 'border-zinc-500/35 bg-zinc-500/10 text-zinc-700 dark:text-zinc-200',
};
const mainAdminEmail = 'sj@incos.co.kr';

function getInitials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

function formatStatus(status: AdminUserStatus) {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function formatLastActive(value?: string) {
  if (!value) {
    return 'Never logged in';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function formatDateInputValue(value?: string) {
  if (!value) {
    return '';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return '';
  }

  const pad = (part: number) => String(part).padStart(2, '0');

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function optionalIsoFromDateInput(value: string) {
  if (!value) {
    return undefined;
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function formatTokenStatus(status?: CanvasTokenStatus | null) {
  if (!status) {
    return 'Unknown';
  }

  return status.status
    .split('_')
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

export function AdminUsersView() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [groups, setGroups] = useState<AdminGroup[]>([]);
  const [query, setQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [actionUserId, setActionUserId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [syncError, setSyncError] = useState('');
  const [canvasTokenUser, setCanvasTokenUser] = useState<AdminUser | null>(null);
  const [canvasTokenStatus, setCanvasTokenStatus] = useState<CanvasTokenStatus | null>(null);
  const [canvasTokenDraft, setCanvasTokenDraft] = useState({
    accessToken: '',
    expiresAt: '',
    instanceUrl: '',
    startsAt: '',
  });
  const [isCanvasTokenLoading, setIsCanvasTokenLoading] = useState(false);
  const [isCanvasTokenSaving, setIsCanvasTokenSaving] = useState(false);
  const [isCanvasTokenResetting, setIsCanvasTokenResetting] = useState(false);
  const [canvasTokenError, setCanvasTokenError] = useState('');
  const [canvasTokenMessage, setCanvasTokenMessage] = useState('');

  const refreshUsers = useCallback(async () => {
    setIsLoading(true);
    setError('');

    try {
      const [userResponse, groupResponse] = await Promise.all([
        workspaceApi.getAdminUsers(),
        workspaceApi.getAdminGroups(),
      ]);
      setUsers(userResponse.users);
      setGroups(groupResponse.groups);
      setSyncError(userResponse.syncError ?? '');
    } catch (loadError: unknown) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load users.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void refreshUsers();
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [refreshUsers]);

  const groupNamesByUserId = useMemo(() => {
    const nextGroupNamesByUserId = new Map<string, string[]>();

    for (const group of groups) {
      for (const member of group.members) {
        nextGroupNamesByUserId.set(member.userId, [
          ...(nextGroupNamesByUserId.get(member.userId) ?? []),
          group.name,
        ]);
      }
    }

    return nextGroupNamesByUserId;
  }, [groups]);

  const filteredUsers = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    if (!normalizedQuery) {
      return users;
    }

    return users.filter((user) => (
      user.displayName.toLowerCase().includes(normalizedQuery) ||
      user.email.toLowerCase().includes(normalizedQuery) ||
      (groupNamesByUserId.get(user.id) ?? []).some((groupName) => (
        groupName.toLowerCase().includes(normalizedQuery)
      ))
    ));
  }, [groupNamesByUserId, query, users]);

  const updateUser = async (user: AdminUser, request: UpdateAdminUserRequest) => {
    setActionUserId(user.id);
    setError('');

    try {
      const updatedUser = await workspaceApi.updateAdminUser(user.id, request);
      setUsers((currentUsers) => currentUsers.map((currentUser) => (
        currentUser.id === updatedUser.id ? updatedUser : currentUser
      )));
    } catch (updateError: unknown) {
      setError(updateError instanceof Error ? updateError.message : 'Unable to update user.');
    } finally {
      setActionUserId(null);
    }
  };

  const openCanvasTokenDialog = (user: AdminUser) => {
    setCanvasTokenUser(user);
    setCanvasTokenStatus(null);
    setCanvasTokenDraft({
      accessToken: '',
      expiresAt: '',
      instanceUrl: '',
      startsAt: '',
    });
    setCanvasTokenError('');
    setCanvasTokenMessage('');
    setIsCanvasTokenLoading(true);

    workspaceApi
      .getAdminUserCanvasTokenStatus(user.id)
      .then((status) => {
        setCanvasTokenStatus(status);
        setCanvasTokenDraft((currentDraft) => ({
          ...currentDraft,
          accessToken: '',
          expiresAt: formatDateInputValue(status.expiresAt),
          instanceUrl: status.instanceUrl ?? currentDraft.instanceUrl,
          startsAt: formatDateInputValue(status.startsAt),
        }));
      })
      .catch((statusError: unknown) => {
        setCanvasTokenError(statusError instanceof Error ? statusError.message : 'Unable to load Canvas token status.');
      })
      .finally(() => setIsCanvasTokenLoading(false));
  };

  const updateCanvasTokenDraft = (field: keyof typeof canvasTokenDraft, value: string) => {
    setCanvasTokenDraft((currentDraft) => ({
      ...currentDraft,
      [field]: value,
    }));
  };

  const handleCanvasTokenSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!canvasTokenUser) {
      return;
    }

    setIsCanvasTokenSaving(true);
    setCanvasTokenError('');
    setCanvasTokenMessage('');

    workspaceApi
      .updateAdminUserCanvasToken(canvasTokenUser.id, {
        accessToken: canvasTokenDraft.accessToken,
        expiresAt: optionalIsoFromDateInput(canvasTokenDraft.expiresAt),
        instanceUrl: canvasTokenDraft.instanceUrl,
        startsAt: optionalIsoFromDateInput(canvasTokenDraft.startsAt),
      })
      .then((status) => {
        setCanvasTokenStatus(status);
        setCanvasTokenDraft((currentDraft) => ({
          ...currentDraft,
          accessToken: '',
          expiresAt: formatDateInputValue(status.expiresAt),
          instanceUrl: status.instanceUrl ?? currentDraft.instanceUrl,
          startsAt: formatDateInputValue(status.startsAt),
        }));
        setCanvasTokenMessage('Canvas token saved.');
      })
      .catch((saveError: unknown) => {
        setCanvasTokenError(saveError instanceof Error ? saveError.message : 'Unable to save Canvas token.');
      })
      .finally(() => setIsCanvasTokenSaving(false));
  };

  const handleCanvasTokenReset = () => {
    if (!canvasTokenUser) {
      return;
    }

    setIsCanvasTokenResetting(true);
    setCanvasTokenError('');
    setCanvasTokenMessage('');

    workspaceApi
      .deleteAdminUserCanvasToken(canvasTokenUser.id)
      .then((status) => {
        setCanvasTokenStatus(status);
        setCanvasTokenDraft((currentDraft) => ({
          ...currentDraft,
          accessToken: '',
          expiresAt: '',
          instanceUrl: status.instanceUrl ?? currentDraft.instanceUrl,
          startsAt: '',
        }));
        setCanvasTokenMessage('Canvas token reset.');
      })
      .catch((resetError: unknown) => {
        setCanvasTokenError(resetError instanceof Error ? resetError.message : 'Unable to reset Canvas token.');
      })
      .finally(() => setIsCanvasTokenResetting(false));
  };

  return (
    <>
    <Card className="rounded-xl bg-card shadow-none">
      <CardHeader className="gap-3 md:flex-row md:items-center md:justify-between">
        <CardTitle className="text-xl font-black">Users</CardTitle>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Badge className="h-8 rounded-lg px-2.5 font-black" variant="outline">
            Google accounts
          </Badge>
          <Input
            className="h-9 w-[220px] rounded-lg"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search users"
            value={query}
          />
          <Button
            aria-label="Refresh users"
            className="size-9 rounded-lg"
            disabled={isLoading}
            onClick={refreshUsers}
            size="icon"
            title="Refresh users"
            type="button"
            variant="outline"
          >
            <RefreshCw className={cn('size-4', isLoading && 'animate-spin')} />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {error || syncError ? (
          <div className="border-y border-yellow-500/25 bg-yellow-400/10 px-4 py-2 text-xs font-bold text-yellow-800 dark:text-yellow-100">
            {error || syncError}
          </div>
        ) : null}
        <div className="overflow-x-auto">
          <div className="min-w-[960px]">
            <div className="grid grid-cols-[minmax(280px,1.5fr)_minmax(160px,0.9fr)_120px_180px_150px] border-y bg-muted/40 px-4 py-2 text-[11px] font-black uppercase text-muted-foreground">
              <span>User</span>
              <span>Group</span>
              <span>State</span>
              <span>Last active</span>
              <span className="text-right">Actions</span>
            </div>
            <div className="divide-y">
              {isLoading && users.length === 0 ? (
                <div className="px-4 py-8 text-sm font-bold text-muted-foreground">Loading users...</div>
              ) : filteredUsers.length === 0 ? (
                <div className="px-4 py-8 text-sm font-bold text-muted-foreground">No users have logged in yet.</div>
              ) : filteredUsers.map((user) => {
                const isBusy = actionUserId === user.id;
                const userGroupNames = groupNamesByUserId.get(user.id) ?? [];
                const isMainAdmin = user.email.toLowerCase() === mainAdminEmail;
                return (
                  <div
                    className={cn(
                      'grid grid-cols-[minmax(280px,1.5fr)_minmax(160px,0.9fr)_120px_180px_150px] items-center gap-3 px-4 py-3',
                      user.status === 'pending' && 'bg-yellow-400/10',
                    )}
                    key={user.id}
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      {user.photoUrl ? (
                        <img
                          alt=""
                          className="size-10 shrink-0 rounded-lg object-cover"
                          referrerPolicy="no-referrer"
                          src={user.photoUrl}
                        />
                      ) : (
                        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/12 text-sm font-black text-primary">
                          {getInitials(user.displayName || user.email)}
                        </div>
                      )}
                      <div className="min-w-0">
                        <div className="truncate text-sm font-black text-foreground">{user.displayName}</div>
                        <div className="flex min-w-0 items-center gap-1 text-xs font-semibold text-muted-foreground">
                          <Mail className="size-3.5 shrink-0" />
                          <span className="truncate">{user.email}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex min-w-0 flex-wrap gap-1.5">
                      {userGroupNames.length === 0 ? (
                        <span className="text-xs font-bold text-muted-foreground">No group</span>
                      ) : userGroupNames.map((groupName) => (
                        <Badge className="max-w-full rounded-md" key={groupName} variant="outline">
                          <span className="truncate">{groupName}</span>
                        </Badge>
                      ))}
                    </div>
                    <Badge className={cn('rounded-md font-black', statusStyles[user.status])} variant="outline">
                      {formatStatus(user.status)}
                    </Badge>
                    <span className="truncate text-sm font-bold text-muted-foreground">
                      {formatLastActive(user.lastLoginAt)}
                    </span>
                    <div className="flex items-center justify-end gap-1.5">
                      {user.status === 'pending' ? (
                        <Button
                          aria-label={`Approve ${user.displayName}`}
                          className="size-9 rounded-lg text-emerald-700 hover:text-emerald-800 dark:text-emerald-200"
                          disabled={isBusy}
                          onClick={() => updateUser(user, { status: 'active' })}
                          size="icon"
                          title="Approve user"
                          type="button"
                          variant="outline"
                        >
                          <CheckCircle2 className="size-4" />
                        </Button>
                      ) : null}
                      <Button
                        aria-label={`Set Canvas token for ${user.displayName}`}
                        className="size-9 rounded-lg"
                        disabled={isBusy}
                        onClick={() => openCanvasTokenDialog(user)}
                        size="icon"
                        title="Set Canvas token"
                        type="button"
                        variant="outline"
                      >
                        <KeyRound className="size-4" />
                      </Button>
                      <Button
                        aria-label={user.status === 'inactive' ? `Activate ${user.displayName}` : `Deactivate ${user.displayName}`}
                        className="size-9 rounded-lg"
                        disabled={isBusy || user.isDirectorySuspended || (isMainAdmin && user.status !== 'inactive')}
                        onClick={() => {
                          if (user.status === 'inactive') {
                            void updateUser(user, { status: 'active' });
                            return;
                          }

                          void updateUser(user, { status: 'inactive' });
                        }}
                        size="icon"
                        title={isMainAdmin ? 'Main Admin stays active' : user.status === 'inactive' ? 'Activate user' : 'Deactivate user'}
                        type="button"
                        variant="outline"
                      >
                        {user.status === 'inactive' ? (
                          <UserCheck className="size-4 text-emerald-600" />
                        ) : (
                          <UserX className="size-4 text-red-600" />
                        )}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
    <Dialog open={Boolean(canvasTokenUser)} onOpenChange={(open) => {
      if (!open) {
        setCanvasTokenUser(null);
      }
    }}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle className="text-lg font-black">Canvas token</DialogTitle>
          <p className="text-sm font-semibold text-muted-foreground">
            {canvasTokenUser?.email}
          </p>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={handleCanvasTokenSubmit}>
          <div className="grid gap-2 rounded-lg border bg-muted/25 p-3 text-sm font-semibold">
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">Status</span>
              <Badge variant={canvasTokenStatus?.connected ? 'default' : 'outline'}>
                {isCanvasTokenLoading ? 'Loading...' : formatTokenStatus(canvasTokenStatus)}
              </Badge>
            </div>
            <div className="flex min-w-0 items-center justify-between gap-3">
              <span className="text-muted-foreground">Connected as</span>
              <span className="min-w-0 truncate text-right">{canvasTokenStatus?.userName ?? 'Not set'}</span>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
            <Label className="grid gap-1.5 text-xs font-black uppercase text-muted-foreground">
              <span>Canvas URL</span>
              <Input
                autoComplete="off"
                inputMode="url"
                onChange={(event) => updateCanvasTokenDraft('instanceUrl', event.target.value)}
                placeholder="https://canvas.sfu.ca"
                required
                value={canvasTokenDraft.instanceUrl}
              />
            </Label>
            <Label className="grid gap-1.5 text-xs font-black uppercase text-muted-foreground">
              <span>API token</span>
              <Input
                autoComplete="new-password"
                onChange={(event) => updateCanvasTokenDraft('accessToken', event.target.value)}
                placeholder="Paste Canvas API token"
                required
                type="password"
                value={canvasTokenDraft.accessToken}
              />
            </Label>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Label className="grid gap-1.5 text-xs font-black uppercase text-muted-foreground">
              <span>Starts at</span>
              <DateTimeField
                defaultTime="00:00"
                onChange={(value) => updateCanvasTokenDraft('startsAt', value)}
                value={canvasTokenDraft.startsAt}
              />
            </Label>
            <Label className="grid gap-1.5 text-xs font-black uppercase text-muted-foreground">
              <span>Expires at</span>
              <DateTimeField
                defaultTime="23:59"
                onChange={(value) => updateCanvasTokenDraft('expiresAt', value)}
                value={canvasTokenDraft.expiresAt}
              />
            </Label>
          </div>
          {canvasTokenError ? (
            <div className="rounded-md border border-red-500/35 bg-red-500/10 px-3 py-2 text-xs font-bold text-red-700 dark:text-red-200">
              {canvasTokenError}
            </div>
          ) : null}
          {canvasTokenMessage ? (
            <div className="rounded-md border border-emerald-500/35 bg-emerald-500/10 px-3 py-2 text-xs font-bold text-emerald-700 dark:text-emerald-200">
              {canvasTokenMessage}
            </div>
          ) : null}
          <DialogFooter>
            <Button
              className="mr-auto"
              disabled={isCanvasTokenSaving || isCanvasTokenResetting || canvasTokenStatus?.tokenSource !== 'user'}
              onClick={handleCanvasTokenReset}
              type="button"
              variant="destructive"
            >
              {isCanvasTokenResetting ? 'Resetting...' : 'Reset'}
            </Button>
            <Button onClick={() => setCanvasTokenUser(null)} type="button" variant="outline">
              Cancel
            </Button>
            <Button disabled={isCanvasTokenSaving || isCanvasTokenResetting || isCanvasTokenLoading} type="submit">
              {isCanvasTokenSaving ? (
                <Loader2 aria-hidden="true" className="size-4 animate-spin" />
              ) : null}
              {isCanvasTokenSaving ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
    </>
  );
}
