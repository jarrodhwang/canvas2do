import { ArrowLeft, CheckCircle2, Clock3, Eye, KeyRound, Loader2, LogOut, Mail, RefreshCw, Save, UserCheck, UserX } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';

import {
  workspaceApi,
  type AdminGroup,
  type AdminUserDetail,
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
const adminPreviewReturnUserStorageKey = 'incos-admin-preview-return-user-id';

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
  const isMountedRef = useRef(true);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [groups, setGroups] = useState<AdminGroup[]>([]);
  const [query, setQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [actionUserId, setActionUserId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [syncError, setSyncError] = useState('');
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [userDetail, setUserDetail] = useState<AdminUserDetail | null>(null);
  const [detailDraft, setDetailDraft] = useState({
    contactEmail: '',
    displayName: '',
    loginId: '',
    password: '',
    photoUrl: '',
  });
  const [isDetailLoading, setIsDetailLoading] = useState(false);
  const [isDetailSaving, setIsDetailSaving] = useState(false);
  const [isRevokingSession, setIsRevokingSession] = useState(false);
  const [isStartingPreview, setIsStartingPreview] = useState(false);
  const [detailMessage, setDetailMessage] = useState('');
  const [detailError, setDetailError] = useState('');
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

  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const refreshUsers = useCallback(async () => {
    setIsLoading(true);
    setError('');

    try {
      const [userResponse, groupResponse] = await Promise.all([
        workspaceApi.getAdminUsers(),
        workspaceApi.getAdminGroups(),
      ]);
      if (!isMountedRef.current) {
        return;
      }

      setUsers(userResponse.users);
      setGroups(groupResponse.groups);
      setSyncError(userResponse.syncError ?? '');
    } catch (loadError: unknown) {
      if (!isMountedRef.current) {
        return;
      }

      setError(loadError instanceof Error ? loadError.message : 'Unable to load users.');
    } finally {
      if (isMountedRef.current) {
        setIsLoading(false);
      }
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
      (user.contactEmail ?? '').toLowerCase().includes(normalizedQuery) ||
      (groupNamesByUserId.get(user.id) ?? []).some((groupName) => (
        groupName.toLowerCase().includes(normalizedQuery)
      ))
    ));
  }, [groupNamesByUserId, query, users]);

  const selectedUser = useMemo(
    () => users.find((user) => user.id === selectedUserId) ?? userDetail?.user ?? null,
    [selectedUserId, userDetail, users],
  );

  const loadUserDetail = useCallback(async (userId: string) => {
    setSelectedUserId(userId);
    setUserDetail(null);
    setDetailDraft({
      contactEmail: '',
      displayName: '',
      loginId: '',
      password: '',
      photoUrl: '',
    });
    setIsDetailLoading(true);
    setDetailError('');
    setDetailMessage('');

    try {
      const detail = await workspaceApi.getAdminUserDetail(userId);
      if (!isMountedRef.current) {
        return;
      }

      setUserDetail(detail);
      setDetailDraft({
        contactEmail: detail.user.contactEmail ?? '',
        displayName: detail.user.displayName,
        loginId: detail.academyLoginId ?? '',
        password: '',
        photoUrl: detail.user.photoUrl ?? '',
      });
    } catch (loadError: unknown) {
      if (!isMountedRef.current) {
        return;
      }

      setDetailError(loadError instanceof Error ? loadError.message : 'Unable to load user details.');
    } finally {
      if (isMountedRef.current) {
        setIsDetailLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const returnUserId = window.sessionStorage.getItem(adminPreviewReturnUserStorageKey);

    if (!returnUserId) {
      return;
    }

    window.sessionStorage.removeItem(adminPreviewReturnUserStorageKey);
    const timeoutId = window.setTimeout(() => {
      void loadUserDetail(returnUserId);
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [loadUserDetail]);

  const updateUser = async (user: AdminUser, request: UpdateAdminUserRequest) => {
    setActionUserId(user.id);
    setError('');

    try {
      const updatedUser = await workspaceApi.updateAdminUser(user.id, request);
      if (!isMountedRef.current) {
        return;
      }

      setUsers((currentUsers) => currentUsers.map((currentUser) => (
        currentUser.id === updatedUser.id ? updatedUser : currentUser
      )));
      setUserDetail((currentDetail) => (
        currentDetail?.user.id === updatedUser.id
          ? { ...currentDetail, user: updatedUser }
          : currentDetail
      ));
    } catch (updateError: unknown) {
      if (!isMountedRef.current) {
        return;
      }

      setError(updateError instanceof Error ? updateError.message : 'Unable to update user.');
    } finally {
      if (isMountedRef.current) {
        setActionUserId(null);
      }
    }
  };

  const updateDetailDraft = (field: keyof typeof detailDraft, value: string) => {
    setDetailDraft((currentDraft) => ({
      ...currentDraft,
      [field]: value,
    }));
  };

  const saveUserDetail = async () => {
    if (!selectedUser) {
      return;
    }

    setIsDetailSaving(true);
    setDetailError('');
    setDetailMessage('');

    try {
      const updatedUser = await workspaceApi.updateAdminUser(selectedUser.id, {
        contactEmail: selectedUser.isAcademyUser ? detailDraft.contactEmail : undefined,
        displayName: detailDraft.displayName,
        loginId: selectedUser.isAcademyUser ? detailDraft.loginId : undefined,
        password: selectedUser.isAcademyUser && detailDraft.password ? detailDraft.password : undefined,
        photoUrl: detailDraft.photoUrl,
      });
      if (!isMountedRef.current) {
        return;
      }

      setUsers((currentUsers) => currentUsers.map((currentUser) => (
        currentUser.id === updatedUser.id ? updatedUser : currentUser
      )));
      await loadUserDetail(updatedUser.id);
      if (!isMountedRef.current) {
        return;
      }

      setDetailMessage('User details saved.');
    } catch (saveError: unknown) {
      if (!isMountedRef.current) {
        return;
      }

      setDetailError(saveError instanceof Error ? saveError.message : 'Unable to save user details.');
    } finally {
      if (isMountedRef.current) {
        setIsDetailSaving(false);
      }
    }
  };

  const revokeUserSession = async () => {
    if (!selectedUser) {
      return;
    }

    setIsRevokingSession(true);
    setDetailError('');
    setDetailMessage('');

    try {
      const updatedUser = await workspaceApi.signOutAdminUser(selectedUser.id);
      if (!isMountedRef.current) {
        return;
      }

      setUsers((currentUsers) => currentUsers.map((currentUser) => (
        currentUser.id === updatedUser.id ? updatedUser : currentUser
      )));
      await loadUserDetail(updatedUser.id);
      if (!isMountedRef.current) {
        return;
      }

      setDetailMessage('Active sessions revoked.');
    } catch (revokeError: unknown) {
      if (!isMountedRef.current) {
        return;
      }

      setDetailError(revokeError instanceof Error ? revokeError.message : 'Unable to revoke this user session.');
    } finally {
      if (isMountedRef.current) {
        setIsRevokingSession(false);
      }
    }
  };

  const startUserPreview = async () => {
    if (!selectedUser) {
      return;
    }

    setIsStartingPreview(true);
    setDetailError('');
    setDetailMessage('');

    try {
      if (typeof window !== 'undefined') {
        window.sessionStorage.setItem(adminPreviewReturnUserStorageKey, selectedUser.id);
      }

      await workspaceApi.previewAdminUser(selectedUser.id);
      window.location.assign('/');
    } catch (previewError: unknown) {
      setDetailError(previewError instanceof Error ? previewError.message : 'Unable to preview this user.');
      setIsStartingPreview(false);
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
        if (!isMountedRef.current) {
          return;
        }

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
        if (!isMountedRef.current) {
          return;
        }

        setCanvasTokenError(statusError instanceof Error ? statusError.message : 'Unable to load Canvas token status.');
      })
      .finally(() => {
        if (isMountedRef.current) {
          setIsCanvasTokenLoading(false);
        }
      });
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
        if (!isMountedRef.current) {
          return;
        }

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
        if (!isMountedRef.current) {
          return;
        }

        setCanvasTokenError(saveError instanceof Error ? saveError.message : 'Unable to save Canvas token.');
      })
      .finally(() => {
        if (isMountedRef.current) {
          setIsCanvasTokenSaving(false);
        }
      });
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
        if (!isMountedRef.current) {
          return;
        }

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
        if (!isMountedRef.current) {
          return;
        }

        setCanvasTokenError(resetError instanceof Error ? resetError.message : 'Unable to reset Canvas token.');
      })
      .finally(() => {
        if (isMountedRef.current) {
          setIsCanvasTokenResetting(false);
        }
      });
  };

  return (
    <>
      <Card className="rounded-xl bg-card shadow-none">
        <CardHeader className="gap-3 md:flex-row md:items-center md:justify-between">
          <CardTitle className="text-xl font-black">{selectedUser ? 'User detail' : 'Users'}</CardTitle>
          {!selectedUser ? (
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
          ) : null}
        </CardHeader>
        <CardContent className="p-0">
          {error || syncError ? (
            <div className="border-y border-yellow-500/25 bg-yellow-400/10 px-4 py-2 text-xs font-bold text-yellow-800 dark:text-yellow-100">
              {error || syncError}
            </div>
          ) : null}
          {selectedUser ? (
            <div className="bg-muted/20 p-4">
            <div className="rounded-xl border bg-background p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <Button
                    className="size-9 rounded-lg"
                    onClick={() => {
                      setSelectedUserId(null);
                      setUserDetail(null);
                      setDetailError('');
                      setDetailMessage('');
                    }}
                    size="icon"
                    type="button"
                    variant="outline"
                  >
                    <ArrowLeft className="size-4" />
                  </Button>
                  {selectedUser.photoUrl ? (
                    <img
                      alt=""
                      className="size-11 shrink-0 rounded-xl object-cover"
                      referrerPolicy="no-referrer"
                      src={selectedUser.photoUrl}
                    />
                  ) : (
                    <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/12 text-sm font-black text-primary">
                      {getInitials(selectedUser.displayName || selectedUser.email)}
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <span className="truncate text-lg font-black">{selectedUser.displayName}</span>
                      <Badge className={cn('rounded-md font-black', statusStyles[selectedUser.status])} variant="outline">
                        {formatStatus(selectedUser.status)}
                      </Badge>
                      {selectedUser.isAcademyUser ? (
                        <Badge className="rounded-md" variant="outline">Academy</Badge>
                      ) : (
                        <Badge className="rounded-md" variant="outline">Google</Badge>
                      )}
                    </div>
                    <div className="truncate text-xs font-bold text-muted-foreground">
                      {selectedUser.isAcademyUser ? selectedUser.contactEmail || 'No email set' : selectedUser.email}
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    disabled={isDetailSaving || isDetailLoading}
                    onClick={saveUserDetail}
                    size="sm"
                    type="button"
                  >
                    {isDetailSaving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                    Save
                  </Button>
                  <Button
                    disabled={isStartingPreview || isDetailLoading}
                    onClick={startUserPreview}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    {isStartingPreview ? <Loader2 className="size-4 animate-spin" /> : <Eye className="size-4" />}
                    Preview
                  </Button>
                  <Button
                    disabled={isRevokingSession || isDetailLoading}
                    onClick={revokeUserSession}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    {isRevokingSession ? <Loader2 className="size-4 animate-spin" /> : <LogOut className="size-4" />}
                    Revoke session
                  </Button>
                </div>
              </div>

              {detailError ? (
                <div className="mt-3 rounded-md border border-red-500/35 bg-red-500/10 px-3 py-2 text-xs font-bold text-red-700 dark:text-red-200">
                  {detailError}
                </div>
              ) : null}
              {detailMessage ? (
                <div className="mt-3 rounded-md border border-emerald-500/35 bg-emerald-500/10 px-3 py-2 text-xs font-bold text-emerald-700 dark:text-emerald-200">
                  {detailMessage}
                </div>
              ) : null}

              <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(260px,1fr)_minmax(260px,0.9fr)]">
                <div className="grid gap-3 rounded-lg border bg-muted/10 p-3">
                  <div className="flex items-center gap-2 text-[11px] font-black uppercase text-muted-foreground">
                    <Eye className="size-3.5" />
                    User details
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    <Label className="grid gap-1.5 text-xs font-black uppercase text-muted-foreground">
                      <span>Name</span>
                      <Input
                        disabled={isDetailLoading}
                        onChange={(event) => updateDetailDraft('displayName', event.target.value)}
                        value={detailDraft.displayName}
                      />
                    </Label>
                    <Label className="grid gap-1.5 text-xs font-black uppercase text-muted-foreground">
                      <span>Profile image URL</span>
                      <Input
                        disabled={isDetailLoading}
                        onChange={(event) => updateDetailDraft('photoUrl', event.target.value)}
                        placeholder="https://..."
                        value={detailDraft.photoUrl}
                      />
                    </Label>
                    <Label className="grid gap-1.5 text-xs font-black uppercase text-muted-foreground">
                      <span>{selectedUser.isAcademyUser ? 'Login ID' : 'Google email'}</span>
                      <Input
                        disabled={isDetailLoading || !selectedUser.isAcademyUser}
                        onChange={(event) => updateDetailDraft('loginId', event.target.value)}
                        value={selectedUser.isAcademyUser ? detailDraft.loginId : selectedUser.email}
                      />
                    </Label>
                    <Label className="grid gap-1.5 text-xs font-black uppercase text-muted-foreground">
                      <span>Actual email</span>
                      <Input
                        autoComplete="email"
                        disabled={isDetailLoading || !selectedUser.isAcademyUser}
                        onChange={(event) => updateDetailDraft('contactEmail', event.target.value)}
                        placeholder={selectedUser.isAcademyUser ? 'Optional' : 'Managed by Google'}
                        type="email"
                        value={selectedUser.isAcademyUser ? detailDraft.contactEmail : selectedUser.email}
                      />
                    </Label>
                    <Label className="grid gap-1.5 text-xs font-black uppercase text-muted-foreground">
                      <span>New password</span>
                      <Input
                        autoComplete="new-password"
                        disabled={isDetailLoading || !selectedUser.isAcademyUser}
                        onChange={(event) => updateDetailDraft('password', event.target.value)}
                        placeholder={selectedUser.isAcademyUser ? 'Leave blank to keep current' : 'Managed by Google'}
                        type="password"
                        value={selectedUser.isAcademyUser ? detailDraft.password : ''}
                      />
                    </Label>
                    <div className="grid gap-1.5 text-xs font-black uppercase text-muted-foreground">
                      <span>Status actions</span>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          disabled={actionUserId === selectedUser.id}
                          onClick={() => updateUser(selectedUser, { status: 'active' })}
                          size="sm"
                          type="button"
                          variant={selectedUser.status === 'active' ? 'default' : 'outline'}
                        >
                          Active
                        </Button>
                        <Button
                          disabled={actionUserId === selectedUser.id}
                          onClick={() => updateUser(selectedUser, { status: 'pending' })}
                          size="sm"
                          type="button"
                          variant={selectedUser.status === 'pending' ? 'default' : 'outline'}
                        >
                          Pending
                        </Button>
                        <Button
                          disabled={actionUserId === selectedUser.id || selectedUser.email.toLowerCase() === mainAdminEmail}
                          onClick={() => updateUser(selectedUser, { status: 'inactive' })}
                          size="sm"
                          type="button"
                          variant={selectedUser.status === 'inactive' ? 'destructive' : 'outline'}
                        >
                          Inactive
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="grid gap-3 rounded-lg border bg-muted/10 p-3">
                  <div className="flex items-center gap-2 text-[11px] font-black uppercase text-muted-foreground">
                    <Clock3 className="size-3.5" />
                    Logs and access
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {(userDetail?.groups.length ? userDetail.groups : groupNamesByUserId.get(selectedUser.id) ?? []).length === 0 ? (
                      <Badge className="rounded-md" variant="outline">No group</Badge>
                    ) : (userDetail?.groups.length ? userDetail.groups : groupNamesByUserId.get(selectedUser.id) ?? []).map((groupName) => (
                      <Badge className="rounded-md" key={groupName} variant="outline">{groupName}</Badge>
                    ))}
                  </div>
                  <div className="grid gap-2 text-sm">
                    {isDetailLoading ? (
                      <div className="text-sm font-bold text-muted-foreground">Loading details...</div>
                    ) : userDetail?.logs.length ? userDetail.logs.map((log) => (
                      <div className="grid gap-1 rounded-lg border bg-background px-3 py-2" key={`${log.action}:${log.at}`}>
                        <div className="flex items-center justify-between gap-3">
                          <span className="font-black">{log.action}</span>
                          <span className="text-xs font-bold text-muted-foreground">{formatLastActive(log.at)}</span>
                        </div>
                        {log.detail ? (
                          <div className="text-xs font-semibold text-muted-foreground">{log.detail}</div>
                        ) : null}
                      </div>
                    )) : (
                      <div className="text-sm font-bold text-muted-foreground">No log entries yet.</div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
          ) : null}
          {!selectedUser ? (
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
                          'grid cursor-pointer grid-cols-[minmax(280px,1.5fr)_minmax(160px,0.9fr)_120px_180px_150px] items-center gap-3 px-4 py-3 text-left transition hover:bg-muted/35',
                          user.status === 'pending' && 'bg-yellow-400/10',
                          selectedUserId === user.id && 'bg-primary/10',
                        )}
                        key={user.id}
                        onClick={() => {
                          void loadUserDetail(user.id);
                        }}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            void loadUserDetail(user.id);
                          }
                        }}
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
                              onClick={(event) => {
                                event.stopPropagation();
                                void updateUser(user, { status: 'active' });
                              }}
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
                            onClick={(event) => {
                              event.stopPropagation();
                              openCanvasTokenDialog(user);
                            }}
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
                            onClick={(event) => {
                              event.stopPropagation();
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
          ) : null}
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
