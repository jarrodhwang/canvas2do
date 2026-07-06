import {
  ArrowLeft,
  BriefcaseBusiness,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  CircleAlert,
  GraduationCap,
  ImageIcon,
  Plus,
  RefreshCw,
  Save,
  ShieldCheck,
  Upload,
  type LucideIcon,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  workspaceApi,
  type AdminGroup,
  type AdminGroupStatus,
  type AdminUser,
  type UpsertAdminGroupRequest,
} from '../api/workspaceApi';
import { cn } from '../lib/utils';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Checkbox } from './ui/checkbox';
import { Input } from './ui/input';
import { Switch } from './ui/switch';
import { Textarea } from './ui/textarea';

type AllocationField = 'permissions' | 'settings' | 'access';

interface PermissionItem {
  id: string;
  label: string;
  field: AllocationField;
}

interface PermissionMenu {
  id: string;
  label: string;
  icon?: LucideIcon;
  items: PermissionItem[];
}

interface PermissionDomain {
  id: string;
  label: string;
  icon: LucideIcon;
  menus: PermissionMenu[];
}

interface GroupFormState {
  name: string;
  description: string;
  photoUrl: string;
  status: AdminGroupStatus;
  permissions: string[];
  settings: string[];
  access: string[];
  memberIds: string[];
}

interface SnackbarState {
  message: string;
  tone: 'success' | 'error';
}

const mainAdminEmail = 'sj@incos.co.kr';

const permissionDomains: PermissionDomain[] = [
  {
    id: 'academy',
    label: 'Academy',
    icon: GraduationCap,
    menus: [
      {
        id: 'academy-dashboard',
        label: 'Dashboard',
        items: [
          { field: 'access', id: 'academy-dashboard', label: 'Access menu' },
        ],
      },
      {
        id: 'academy-courses',
        label: 'Courses',
        items: [
          { field: 'access', id: 'academy-courses', label: 'Access menu' },
          { field: 'permissions', id: 'academy-view-courses', label: 'View courses' },
          { field: 'permissions', id: 'academy-manage-courses', label: 'Manage courses' },
        ],
      },
      {
        id: 'academy-grades',
        label: 'Grades',
        items: [
          { field: 'access', id: 'academy-grades', label: 'Access menu' },
        ],
      },
      {
        id: 'academy-inbox',
        label: 'Inbox',
        items: [
          { field: 'access', id: 'academy-inbox', label: 'Access menu' },
          { field: 'permissions', id: 'academy-manage-inbox', label: 'Manage inbox' },
        ],
      },
      {
        id: 'academy-people',
        label: 'People',
        items: [
          { field: 'access', id: 'academy-people', label: 'Access menu' },
          { field: 'permissions', id: 'academy-view-people', label: 'View people' },
          { field: 'permissions', id: 'academy-message-people', label: 'Message people' },
        ],
      },
      {
        id: 'academy-outlook',
        label: 'Outlook',
        items: [
          { field: 'access', id: 'academy-outlook', label: 'Access menu' },
        ],
      },
      {
        id: 'academy-settings',
        label: 'Settings',
        items: [
          { field: 'access', id: 'academy-settings-page', label: 'Access menu' },
          { field: 'settings', id: 'academy-settings', label: 'Manage settings' },
          { field: 'permissions', id: 'academy-manage-settings', label: 'Change settings' },
        ],
      },
    ],
  },
  {
    id: 'workspace',
    label: 'Workspace',
    icon: BriefcaseBusiness,
    menus: [
      {
        id: 'workspace-dashboard',
        label: 'Dashboard',
        items: [
          { field: 'access', id: 'workspace-dashboard', label: 'Access menu' },
          { field: 'permissions', id: 'workspace-view-dashboard', label: 'View dashboard' },
        ],
      },
      {
        id: 'workspace-project',
        label: 'Project',
        items: [
          { field: 'access', id: 'workspace-project', label: 'Access menu' },
        ],
      },
      {
        id: 'workspace-calendar',
        label: 'Calendar',
        items: [
          { field: 'access', id: 'workspace-calendar', label: 'Access menu' },
          { field: 'permissions', id: 'workspace-manage-calendar', label: 'Manage calendar' },
        ],
      },
      {
        id: 'workspace-board',
        label: 'Board',
        items: [
          { field: 'access', id: 'workspace-board', label: 'Access menu' },
        ],
      },
      {
        id: 'workspace-timeline',
        label: 'Timeline',
        items: [
          { field: 'access', id: 'workspace-timeline', label: 'Access menu' },
        ],
      },
      {
        id: 'workspace-issues',
        label: 'Issues',
        items: [
          { field: 'access', id: 'workspace-issues', label: 'Access menu' },
        ],
      },
      {
        id: 'workspace-bugs',
        label: 'Bugs',
        items: [
          { field: 'access', id: 'workspace-bugs', label: 'Access menu' },
        ],
      },
      {
        id: 'workspace-features',
        label: 'Feature Ideas',
        items: [
          { field: 'access', id: 'workspace-features', label: 'Access menu' },
        ],
      },
      {
        id: 'workspace-customers',
        label: 'Customers',
        items: [
          { field: 'access', id: 'workspace-customers', label: 'Access menu' },
        ],
      },
      {
        id: 'workspace-colleagues',
        label: 'Colleagues',
        items: [
          { field: 'access', id: 'workspace-colleagues', label: 'Access menu' },
        ],
      },
      {
        id: 'workspace-categories',
        label: 'Categories',
        items: [
          { field: 'access', id: 'workspace-categories', label: 'Access menu' },
        ],
      },
      {
        id: 'workspace-drive',
        label: 'Drive',
        items: [
          { field: 'access', id: 'workspace-drive', label: 'Access menu' },
          { field: 'permissions', id: 'workspace-manage-files', label: 'Manage files' },
        ],
      },
      {
        id: 'workspace-communication',
        label: 'Communication',
        items: [
          { field: 'access', id: 'workspace-email', label: 'Email' },
          { field: 'access', id: 'workspace-chat', label: 'Chat' },
          { field: 'permissions', id: 'workspace-manage-email', label: 'Manage email' },
          { field: 'permissions', id: 'workspace-manage-chat', label: 'Manage chat' },
        ],
      },
      {
        id: 'workspace-toptrack',
        label: 'TopTrack',
        items: [
          { field: 'access', id: 'workspace-toptrack', label: 'Access menu' },
        ],
      },
      {
        id: 'workspace-links',
        label: 'Links',
        items: [
          { field: 'access', id: 'workspace-links', label: 'Access menu' },
        ],
      },
      {
        id: 'workspace-settings',
        label: 'Settings',
        items: [
          { field: 'access', id: 'workspace-settings', label: 'Access menu' },
          { field: 'settings', id: 'workspace-settings', label: 'Manage settings' },
        ],
      },
    ],
  },
  {
    id: 'admin-console',
    label: 'Admin Console',
    icon: ShieldCheck,
    menus: [
      {
        id: 'admin-dashboard',
        label: 'Dashboard',
        items: [
          { field: 'access', id: 'admin-dashboard', label: 'Access menu' },
        ],
      },
      {
        id: 'admin-users',
        label: 'Users',
        items: [
          { field: 'access', id: 'admin-users', label: 'Access menu' },
          { field: 'permissions', id: 'admin-manage-users', label: 'Manage users' },
        ],
      },
      {
        id: 'admin-groups',
        label: 'Groups',
        items: [
          { field: 'access', id: 'admin-groups', label: 'Access menu' },
          { field: 'permissions', id: 'admin-manage-groups', label: 'Manage groups' },
        ],
      },
      {
        id: 'admin-customers',
        label: 'Customers',
        items: [
          { field: 'access', id: 'admin-customers', label: 'Access menu' },
        ],
      },
      {
        id: 'admin-licenses',
        label: 'Licenses',
        items: [
          { field: 'access', id: 'admin-licenses', label: 'Access menu' },
          { field: 'permissions', id: 'admin-manage-billing', label: 'Manage billing' },
        ],
      },
      {
        id: 'admin-products',
        label: 'Products',
        items: [
          { field: 'access', id: 'admin-products', label: 'Access menu' },
          { field: 'permissions', id: 'admin-manage-products', label: 'Manage products' },
        ],
      },
      {
        id: 'admin-invoices',
        label: 'Invoices',
        items: [
          { field: 'access', id: 'admin-invoices', label: 'Access menu' },
          { field: 'permissions', id: 'admin-manage-billing', label: 'Manage billing' },
        ],
      },
      {
        id: 'admin-settings',
        label: 'Settings',
        items: [
          { field: 'access', id: 'admin-settings-general', label: 'General' },
          { field: 'settings', id: 'admin-general-settings', label: 'Manage general' },
          { field: 'access', id: 'admin-permissions', label: 'Permissions' },
          { field: 'settings', id: 'admin-permissions-settings', label: 'Manage permissions' },
          { field: 'permissions', id: 'admin-manage-permissions', label: 'Change permissions' },
          { field: 'access', id: 'admin-audit-logs', label: 'Audit logs' },
          { field: 'settings', id: 'admin-audit-logs-settings', label: 'Audit log settings' },
          { field: 'permissions', id: 'admin-view-audit-logs', label: 'View audit logs' },
          { field: 'access', id: 'admin-workspace-mode', label: 'Workspace mode' },
          { field: 'settings', id: 'admin-workspace-mode-settings', label: 'Manage workspace mode' },
          { field: 'permissions', id: 'admin-manage-workspace-mode', label: 'Change workspace mode' },
          { field: 'access', id: 'api', label: 'API access' },
        ],
      },
    ],
  },
];
const permissionItems = permissionDomains.flatMap((domain) => domain.menus.flatMap((menu) => menu.items));

const emptyForm: GroupFormState = {
  name: '',
  description: '',
  photoUrl: '',
  status: 'active',
  permissions: [],
  settings: [],
  access: [],
  memberIds: [],
};

const statusStyles: Record<AdminGroupStatus, string> = {
  active: 'border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200',
  inactive: 'border-zinc-500/35 bg-zinc-500/10 text-zinc-700 dark:text-zinc-200',
};

function getInitials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

function toggleValue(values: string[], id: string) {
  return values.includes(id)
    ? values.filter((value) => value !== id)
    : [...values, id];
}

function formatStatus(status: AdminGroupStatus) {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function toRequest(form: GroupFormState): UpsertAdminGroupRequest {
  return {
    access: form.access,
    description: form.description,
    memberIds: form.memberIds,
    name: form.name,
    permissions: form.permissions,
    photoUrl: form.photoUrl,
    settings: form.settings,
    status: form.status,
  };
}

function formFromGroup(group: AdminGroup): GroupFormState {
  return {
    access: group.access,
    description: group.description ?? '',
    memberIds: group.members.map((member) => member.userId),
    name: group.name,
    permissions: group.permissions,
    photoUrl: group.photoUrl ?? '',
    settings: group.settings,
    status: group.status,
  };
}

function countSelections(form: GroupFormState) {
  return permissionItems.filter((item) => hasItem(form, item)).length;
}

function hasItem(form: GroupFormState, item: PermissionItem) {
  return form[item.field].includes(item.id);
}

function getMenuSelectionCount(form: GroupFormState, menu: PermissionMenu) {
  return menu.items.filter((item) => hasItem(form, item)).length;
}

function getDomainItems(domain: PermissionDomain) {
  return domain.menus.flatMap((menu) => menu.items);
}

function isAcademyUser(user: AdminUser | undefined) {
  return Boolean(user?.isAcademyUser || user?.email.toLowerCase().endsWith('@academy.local'));
}

function isAcademyGrant(item: PermissionItem) {
  if (item.field === 'access') {
    return item.id === 'academy' || item.id.startsWith('academy-');
  }

  if (item.field === 'permissions') {
    return item.id.startsWith('academy-');
  }

  return item.id === 'academy-settings';
}

function hasWorkspaceOrAdminGrant(form: GroupFormState) {
  return permissionItems.some((item) => hasItem(form, item) && !isAcademyGrant(item));
}

function hasAcademyMember(form: GroupFormState, userById: Map<string, AdminUser>) {
  return form.memberIds.some((userId) => isAcademyUser(userById.get(userId)));
}

function stripWorkspaceAndAdminGrants(form: GroupFormState): GroupFormState {
  return {
    ...form,
    access: form.access.filter((value) => value === 'academy' || value.startsWith('academy-')),
    permissions: form.permissions.filter((value) => value.startsWith('academy-')),
    settings: form.settings.filter((value) => value === 'academy-settings'),
  };
}

function stripAcademyMembers(form: GroupFormState, userById: Map<string, AdminUser>): GroupFormState {
  return {
    ...form,
    memberIds: form.memberIds.filter((userId) => !isAcademyUser(userById.get(userId))),
  };
}

function hasSameValues(left: string[], right: string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function isSameGroupForm(left: GroupFormState, right: GroupFormState) {
  return (
    left.name === right.name &&
    left.description === right.description &&
    left.photoUrl === right.photoUrl &&
    left.status === right.status &&
    hasSameValues(left.access, right.access) &&
    hasSameValues(left.permissions, right.permissions) &&
    hasSameValues(left.settings, right.settings) &&
    hasSameValues(left.memberIds, right.memberIds)
  );
}

function areItemsGranted(form: GroupFormState, items: PermissionItem[]) {
  return items.length > 0 && items.every((item) => hasItem(form, item));
}

function setPermissionItems(form: GroupFormState, items: PermissionItem[], shouldGrant: boolean): GroupFormState {
  const nextValues: Record<AllocationField, Set<string>> = {
    access: new Set(form.access),
    permissions: new Set(form.permissions),
    settings: new Set(form.settings),
  };

  for (const item of items) {
    if (shouldGrant) {
      nextValues[item.field].add(item.id);
    } else {
      nextValues[item.field].delete(item.id);
    }
  }

  return {
    ...form,
    access: Array.from(nextValues.access),
    permissions: Array.from(nextValues.permissions),
    settings: Array.from(nextValues.settings),
  };
}

function grantedCheckboxClassName(isGranted: boolean) {
  return isGranted ? 'data-checked:border-emerald-600 data-checked:bg-emerald-600 data-checked:text-white' : '';
}

export function AdminGroupsView() {
  const detailHistoryPushedRef = useRef(false);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const snackbarTimeoutRef = useRef<number | null>(null);
  const [groups, setGroups] = useState<AdminGroup[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [form, setForm] = useState<GroupFormState>(emptyForm);
  const [query, setQuery] = useState('');
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [expandedDomainIds, setExpandedDomainIds] = useState<string[]>([]);
  const [expandedMenuIds, setExpandedMenuIds] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [snackbar, setSnackbar] = useState<SnackbarState | null>(null);

  const editingGroup = useMemo(
    () => groups.find((group) => group.id === editingGroupId) ?? null,
    [editingGroupId, groups],
  );
  const isProtectedEdit = editingGroup?.isProtected ?? false;
  const userById = useMemo(
    () => new Map(users.map((user) => [user.id, user])),
    [users],
  );
  const formHasAcademyMembers = useMemo(
    () => hasAcademyMember(form, userById),
    [form, userById],
  );
  const formHasWorkspaceOrAdminGrants = useMemo(
    () => hasWorkspaceOrAdminGrant(form),
    [form],
  );
  const visibleUsers = useMemo(
    () => formHasWorkspaceOrAdminGrants
      ? users.filter((user) => !isAcademyUser(user))
      : users,
    [formHasWorkspaceOrAdminGrants, users],
  );
  const visiblePermissionDomains = useMemo(
    () => formHasAcademyMembers
      ? permissionDomains.filter((domain) => domain.id === 'academy')
      : permissionDomains,
    [formHasAcademyMembers],
  );

  const clearEditor = useCallback(() => {
    setIsEditorOpen(false);
    setEditingGroupId(null);
    setForm(emptyForm);
    setExpandedDomainIds([]);
    setExpandedMenuIds([]);
  }, []);

  const pushDetailHistory = () => {
    if (detailHistoryPushedRef.current) {
      return;
    }

    window.history.pushState({ incosAdminGroupsDetail: true }, '', window.location.href);
    detailHistoryPushedRef.current = true;
  };

  const showSnackbar = useCallback((nextSnackbar: SnackbarState) => {
    if (snackbarTimeoutRef.current !== null) {
      window.clearTimeout(snackbarTimeoutRef.current);
    }

    setSnackbar(nextSnackbar);
    snackbarTimeoutRef.current = window.setTimeout(() => {
      setSnackbar(null);
      snackbarTimeoutRef.current = null;
    }, 3200);
  }, []);

  const refreshGroups = useCallback(async () => {
    setIsLoading(true);
    setError('');

    try {
      const [userResponse, groupResponse] = await Promise.all([
        workspaceApi.getAdminUsers(),
        workspaceApi.getAdminGroups(),
      ]);
      setUsers(userResponse.users);
      setGroups(groupResponse.groups);
    } catch (loadError: unknown) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load groups.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void refreshGroups();
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [refreshGroups]);

  useEffect(() => {
    const handlePopState = () => {
      if (!isEditorOpen) {
        return;
      }

      detailHistoryPushedRef.current = false;
      clearEditor();
    };

    window.addEventListener('popstate', handlePopState);

    return () => window.removeEventListener('popstate', handlePopState);
  }, [clearEditor, isEditorOpen]);

  useEffect(() => () => {
    if (snackbarTimeoutRef.current !== null) {
      window.clearTimeout(snackbarTimeoutRef.current);
    }
  }, []);

  useEffect(() => {
    if (isProtectedEdit || !formHasAcademyMembers) {
      return;
    }

    setForm((currentForm) => {
      const nextForm = stripWorkspaceAndAdminGrants(currentForm);
      return isSameGroupForm(currentForm, nextForm) ? currentForm : nextForm;
    });
  }, [formHasAcademyMembers, isProtectedEdit]);

  useEffect(() => {
    if (isProtectedEdit || !formHasWorkspaceOrAdminGrants) {
      return;
    }

    setForm((currentForm) => {
      const nextForm = stripAcademyMembers(currentForm, userById);
      return isSameGroupForm(currentForm, nextForm) ? currentForm : nextForm;
    });
  }, [formHasWorkspaceOrAdminGrants, isProtectedEdit, userById]);

  const filteredGroups = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    if (!normalizedQuery) {
      return groups;
    }

    return groups.filter((group) => (
      group.name.toLowerCase().includes(normalizedQuery) ||
      (group.description ?? '').toLowerCase().includes(normalizedQuery) ||
      group.members.some((member) => (
        member.displayName.toLowerCase().includes(normalizedQuery) ||
        member.email.toLowerCase().includes(normalizedQuery)
      ))
    ));
  }, [groups, query]);

  const toggleDomain = (domainId: string) => {
    setExpandedDomainIds((currentIds) => toggleValue(currentIds, domainId));
  };

  const toggleMenu = (menuId: string) => {
    setExpandedMenuIds((currentIds) => toggleValue(currentIds, menuId));
  };

  const openCreateEditor = () => {
    pushDetailHistory();
    setEditingGroupId(null);
    setForm(emptyForm);
    setIsEditorOpen(true);
    setExpandedDomainIds([]);
    setExpandedMenuIds([]);
    setError('');
  };

  const openGroupEditor = (group: AdminGroup) => {
    pushDetailHistory();
    setEditingGroupId(group.id);
    setForm(formFromGroup(group));
    setIsEditorOpen(true);
    setExpandedDomainIds([]);
    setExpandedMenuIds([]);
    setError('');
  };

  const closeEditor = () => {
    clearEditor();

    if (detailHistoryPushedRef.current) {
      detailHistoryPushedRef.current = false;
      window.history.back();
    }
  };

  const returnToGroupList = () => {
    clearEditor();

    if (!detailHistoryPushedRef.current) {
      return;
    }

    detailHistoryPushedRef.current = false;
    window.history.replaceState(null, '', window.location.href);
  };

  const togglePermissionItem = (item: PermissionItem) => {
    if (isProtectedEdit) {
      return;
    }

    const nextForm = {
      ...form,
      [item.field]: toggleValue(form[item.field], item.id),
    };

    setForm(nextForm);
  };

  const togglePermissionItems = (items: PermissionItem[]) => {
    if (isProtectedEdit) {
      return;
    }

    const nextForm = setPermissionItems(
      form,
      items,
      !areItemsGranted(form, items),
    );

    setForm(nextForm);
  };

  const toggleMember = (userId: string) => {
    if (isProtectedEdit) {
      return;
    }

    setForm((currentForm) => ({
      ...currentForm,
      memberIds: toggleValue(currentForm.memberIds, userId),
    }));
  };

  const uploadProfileImage = (file: File | undefined) => {
    if (!file || isProtectedEdit) {
      return;
    }

    const reader = new FileReader();
    reader.addEventListener('load', () => {
      setForm((currentForm) => ({
        ...currentForm,
        photoUrl: typeof reader.result === 'string' ? reader.result : currentForm.photoUrl,
      }));
    });
    reader.readAsDataURL(file);
  };

  const saveGroup = async () => {
    if (!form.name.trim()) {
      setError('Group name is required.');
      showSnackbar({ message: 'Failed to save group.', tone: 'error' });
      return;
    }

    setIsSaving(true);
    setError('');
    const isEditing = Boolean(editingGroup);

    try {
      if (editingGroup) {
        await workspaceApi.updateAdminGroup(editingGroup.id, toRequest(form));
      } else {
        await workspaceApi.createAdminGroup(toRequest(form));
      }

      const groupResponse = await workspaceApi.getAdminGroups();
      setGroups(groupResponse.groups);
      returnToGroupList();
      showSnackbar({ message: isEditing ? 'Group saved.' : 'Group created.', tone: 'success' });
    } catch (saveError: unknown) {
      const message = saveError instanceof Error ? saveError.message : 'Unable to save group.';
      setError(message);
      showSnackbar({ message, tone: 'error' });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Card className="rounded-xl bg-card shadow-none">
      <CardHeader className="gap-3 md:flex-row md:items-center md:justify-between">
        <CardTitle className="text-xl font-black">Groups</CardTitle>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Input
            className="h-9 w-[220px] rounded-lg"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search groups"
            value={query}
          />
          <Button
            aria-label="Create group"
            className="h-9 rounded-lg"
            onClick={openCreateEditor}
            type="button"
            variant="outline"
          >
            <Plus className="size-4" />
            Create group
          </Button>
          <Button
            aria-label="Refresh groups"
            className="size-9 rounded-lg"
            disabled={isLoading}
            onClick={refreshGroups}
            size="icon"
            title="Refresh groups"
            type="button"
            variant="outline"
          >
            <RefreshCw className={cn('size-4', isLoading && 'animate-spin')} />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {error ? (
          <div className="border-y border-red-500/25 bg-red-500/10 px-4 py-2 text-xs font-bold text-red-700 dark:text-red-200">
            {error}
          </div>
        ) : null}

        {isEditorOpen ? (
          <div className="border-y bg-muted/20 px-4 py-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <Button
                  className="h-8 rounded-lg"
                  onClick={closeEditor}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  <ArrowLeft className="size-4" />
                  Groups
                </Button>
                <div className="truncate text-sm font-black">
                  {editingGroup ? editingGroup.name : 'Create group'}
                </div>
                {isProtectedEdit ? (
                  <Badge className="rounded-md border-amber-500/35 bg-amber-400/15 text-amber-800 dark:text-amber-100" variant="outline">
                    <ShieldCheck className="size-3" />
                    Protected
                  </Badge>
                ) : null}
              </div>
              <div className="flex items-center gap-1.5">
                <Button
                  disabled={isSaving || isProtectedEdit}
                  onClick={saveGroup}
                  size="sm"
                  type="button"
                >
                  <Save className="size-4" />
                  Save
                </Button>
                <Button
                  className="h-8 rounded-lg"
                  onClick={closeEditor}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  Back
                </Button>
              </div>
            </div>

            <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(180px,1fr)_minmax(180px,1fr)_auto_auto]">
              <Input
                className="h-9 rounded-lg"
                disabled={isProtectedEdit}
                onChange={(event) => setForm((currentForm) => ({ ...currentForm, name: event.target.value }))}
                placeholder="Group name"
                value={form.name}
              />
              <Input
                className="h-9 rounded-lg"
                disabled={isProtectedEdit}
                onChange={(event) => setForm((currentForm) => ({ ...currentForm, photoUrl: event.target.value }))}
                placeholder="Profile image URL"
                value={form.photoUrl}
              />
              <input
                accept="image/*"
                className="hidden"
                disabled={isProtectedEdit}
                onChange={(event) => uploadProfileImage(event.target.files?.[0])}
                ref={imageInputRef}
                type="file"
              />
              <Button
                className="h-9 rounded-lg"
                disabled={isProtectedEdit}
                onClick={() => imageInputRef.current?.click()}
                type="button"
                variant="outline"
              >
                <Upload className="size-4" />
                Upload
              </Button>
              <label className="flex h-9 items-center justify-end gap-2 text-xs font-black text-muted-foreground">
                <span>{formatStatus(form.status)}</span>
                <Switch
                  checked={form.status === 'active'}
                  disabled={isProtectedEdit}
                  onCheckedChange={(checked) => {
                    setForm((currentForm) => ({ ...currentForm, status: checked ? 'active' : 'inactive' }));
                  }}
                  size="default"
                />
              </label>
            </div>
            <Textarea
              className="mt-3 min-h-16 rounded-lg"
              disabled={isProtectedEdit}
              onChange={(event) => setForm((currentForm) => ({ ...currentForm, description: event.target.value }))}
              placeholder="Description"
              value={form.description}
            />

            <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(240px,0.9fr)_minmax(360px,1.5fr)]">
              <div className="min-w-0 rounded-lg border bg-background p-3">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <div className="text-[11px] font-black uppercase text-muted-foreground">Users</div>
                  <Badge className="rounded-md" variant="outline">{form.memberIds.length}</Badge>
                </div>
                {formHasWorkspaceOrAdminGrants ? (
                  <div className="mb-2 rounded-md border border-amber-500/25 bg-amber-500/10 px-2 py-1.5 text-[11px] font-bold text-amber-800 dark:text-amber-100">
                    Academy users are hidden while Workspace or Admin permissions are selected.
                  </div>
                ) : null}
                <div className="grid max-h-[300px] gap-2 overflow-y-auto pr-1">
                  {visibleUsers.length === 0 ? (
                    <div className="text-sm font-bold text-muted-foreground">No users found.</div>
                  ) : visibleUsers.map((user) => {
                    const isMainAdmin = user.email.toLowerCase() === mainAdminEmail;
                    const userIsAcademy = isAcademyUser(user);

                    return (
                      <label
                        className={cn(
                          'flex min-w-0 items-center gap-2 rounded-lg border px-2.5 py-2 text-sm font-bold',
                          form.memberIds.includes(user.id) ? 'bg-primary/10' : 'bg-card',
                          isProtectedEdit && 'opacity-60',
                        )}
                        key={user.id}
                      >
                        <Checkbox
                          checked={form.memberIds.includes(user.id)}
                          disabled={isProtectedEdit || (editingGroup?.isProtected && isMainAdmin)}
                          onCheckedChange={() => toggleMember(user.id)}
                        />
                        {user.photoUrl ? (
                          <img
                            alt=""
                            className="size-7 shrink-0 rounded-md object-cover"
                            referrerPolicy="no-referrer"
                            src={user.photoUrl}
                          />
                        ) : (
                          <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary/12 text-xs font-black text-primary">
                            {getInitials(user.displayName || user.email)}
                          </div>
                        )}
                        <span className="min-w-0 flex-1 truncate">{user.displayName}</span>
                        {userIsAcademy ? (
                          <Badge className="rounded-md" variant="outline">Academy</Badge>
                        ) : null}
                      </label>
                    );
                  })}
                </div>
              </div>

              <div className="min-w-0 rounded-lg border bg-background p-3">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <div className="text-[11px] font-black uppercase text-muted-foreground">Permissions</div>
                  <Badge className="rounded-md" variant="outline">{countSelections(form)}</Badge>
                </div>
                {formHasAcademyMembers ? (
                  <div className="mb-2 rounded-md border border-sky-500/25 bg-sky-500/10 px-2 py-1.5 text-[11px] font-bold text-sky-800 dark:text-sky-100">
                    Academy users can only receive Academy access, permissions, and settings.
                  </div>
                ) : null}
                <div className="space-y-2">
                  {visiblePermissionDomains.map((domain) => {
                    const isDomainOpen = expandedDomainIds.includes(domain.id);
                    const domainItems = getDomainItems(domain);
                    const isDomainGranted = areItemsGranted(form, domainItems);
                    const DomainIcon = domain.icon;

                    return (
                      <div className="rounded-lg border" key={domain.id}>
                        <div className="flex items-center justify-between gap-3 px-3 py-2">
                          <label
                            className={cn(
                              'flex min-w-0 flex-1 items-center gap-2 text-sm font-black',
                              isDomainGranted && 'text-emerald-700 dark:text-emerald-200',
                            )}
                          >
                            <Checkbox
                              checked={isDomainGranted}
                              className={grantedCheckboxClassName(isDomainGranted)}
                              disabled={isProtectedEdit}
                              onCheckedChange={() => togglePermissionItems(domainItems)}
                            />
                            <DomainIcon className="size-4 shrink-0" />
                            <span className="truncate">{domain.label}</span>
                          </label>
                          <button
                            aria-label={`${isDomainOpen ? 'Collapse' : 'Expand'} ${domain.label}`}
                            className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
                            onClick={() => toggleDomain(domain.id)}
                            type="button"
                          >
                            {isDomainOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                          </button>
                        </div>
                        {isDomainOpen ? (
                          <div className="space-y-2 border-t p-2">
                            {domain.menus.map((menu) => {
                              const isMenuOpen = expandedMenuIds.includes(menu.id);
                              const selectedCount = getMenuSelectionCount(form, menu);
                              const isMenuGranted = areItemsGranted(form, menu.items);
                              const MenuIcon = menu.icon ?? domain.icon;

                              return (
                                <div className="rounded-md border bg-muted/20" key={menu.id}>
                                  <div className="flex items-center justify-between gap-3 px-2.5 py-2">
                                    <label
                                      className={cn(
                                        'flex min-w-0 flex-1 items-center gap-2 text-xs font-black',
                                        isMenuGranted && 'text-emerald-700 dark:text-emerald-200',
                                      )}
                                    >
                                      <Checkbox
                                        checked={isMenuGranted}
                                        className={grantedCheckboxClassName(isMenuGranted)}
                                        disabled={isProtectedEdit}
                                        onCheckedChange={() => togglePermissionItems(menu.items)}
                                      />
                                      <MenuIcon className="size-3.5 shrink-0" />
                                      <span className="truncate">{menu.label}</span>
                                    </label>
                                    <button
                                      aria-label={`${isMenuOpen ? 'Collapse' : 'Expand'} ${menu.label}`}
                                      className="flex items-center gap-2 rounded-md px-1.5 py-1 text-muted-foreground hover:bg-muted"
                                      onClick={() => toggleMenu(menu.id)}
                                      type="button"
                                    >
                                      <span className="text-[11px] font-black">{selectedCount}/{menu.items.length}</span>
                                      {isMenuOpen ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                                    </button>
                                  </div>
                                  {isMenuOpen ? (
                                    <div className="flex flex-wrap gap-2 border-t p-2">
                                      {menu.items.map((item) => {
                                        const isItemGranted = hasItem(form, item);

                                        return (
                                          <label
                                            className={cn(
                                              'flex h-8 items-center gap-2 rounded-lg border px-2.5 text-xs font-bold transition',
                                              isItemGranted
                                                ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200'
                                                : 'bg-background text-muted-foreground',
                                            )}
                                            key={`${item.field}:${item.id}`}
                                          >
                                            <Checkbox
                                              checked={isItemGranted}
                                              className={grantedCheckboxClassName(isItemGranted)}
                                              disabled={isProtectedEdit}
                                              onCheckedChange={() => togglePermissionItem(item)}
                                            />
                                            <span>{item.label}</span>
                                          </label>
                                        );
                                      })}
                                    </div>
                                  ) : null}
                                </div>
                              );
                            })}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {!isEditorOpen ? (
        <div className="overflow-x-auto">
          <div className="min-w-[860px]">
            <div className="grid grid-cols-[minmax(250px,1.3fr)_130px_160px_minmax(220px,1fr)] border-b bg-muted/40 px-4 py-2 text-[11px] font-black uppercase text-muted-foreground">
              <span>Group</span>
              <span>State</span>
              <span>Users</span>
              <span>Permissions</span>
            </div>
            <div className="divide-y">
              {isLoading && groups.length === 0 ? (
                <div className="px-4 py-8 text-sm font-bold text-muted-foreground">Loading groups...</div>
              ) : filteredGroups.length === 0 ? (
                <div className="px-4 py-8 text-sm font-bold text-muted-foreground">No groups found.</div>
              ) : filteredGroups.map((group) => {
                const selectionCount = countSelections(formFromGroup(group));

                return (
                  <button
                    className={cn(
                      'grid w-full grid-cols-[minmax(250px,1.3fr)_130px_160px_minmax(220px,1fr)] items-center gap-3 px-4 py-4 text-left transition hover:bg-muted/35',
                      editingGroupId === group.id && isEditorOpen && 'bg-primary/5',
                    )}
                    key={group.id}
                    onClick={() => openGroupEditor(group)}
                    type="button"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      {group.photoUrl ? (
                        <img
                          alt=""
                          className="size-11 shrink-0 rounded-lg object-cover"
                          referrerPolicy="no-referrer"
                          src={group.photoUrl}
                        />
                      ) : (
                        <div className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-primary/12 text-sm font-black text-primary">
                          {getInitials(group.name) || <ImageIcon className="size-4" />}
                        </div>
                      )}
                      <div className="min-w-0">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="truncate text-sm font-black text-foreground">{group.name}</span>
                          {group.isProtected ? (
                            <ShieldCheck className="size-4 shrink-0 text-amber-600" />
                          ) : null}
                        </div>
                        <div className="line-clamp-2 text-xs font-semibold text-muted-foreground">
                          {group.description || 'No description'}
                        </div>
                      </div>
                    </div>
                    <Badge className={cn('rounded-md font-black', statusStyles[group.status])} variant="outline">
                      {formatStatus(group.status)}
                    </Badge>
                    <div className="flex items-center gap-1.5">
                      {group.members.slice(0, 4).map((member) => (
                        member.photoUrl ? (
                          <img
                            alt=""
                            className="size-7 rounded-md object-cover"
                            key={member.userId}
                            referrerPolicy="no-referrer"
                            src={member.photoUrl}
                          />
                        ) : (
                          <span
                            className="flex size-7 items-center justify-center rounded-md bg-muted text-[10px] font-black"
                            key={member.userId}
                          >
                            {getInitials(member.displayName || member.email)}
                          </span>
                        )
                      ))}
                      <span className="text-xs font-black text-muted-foreground">{group.members.length}</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <Badge className="rounded-md" variant="outline">{selectionCount}</Badge>
                      {group.access.includes('admin-console') || group.access.includes('admin-dashboard') ? (
                        <Badge className="rounded-md" variant="outline">Admin</Badge>
                      ) : null}
                      {group.access.some((access) => access.startsWith('academy')) ? (
                        <Badge className="rounded-md" variant="outline">Academy</Badge>
                      ) : null}
                      {group.access.some((access) => access.startsWith('workspace')) ? (
                        <Badge className="rounded-md" variant="outline">Workspace</Badge>
                      ) : null}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
        ) : null}
      </CardContent>
      {snackbar ? (
        <div
          aria-live="polite"
          className={cn(
            'fixed bottom-5 right-5 z-50 flex max-w-[min(360px,calc(100vw-2.5rem))] items-center gap-2 rounded-lg border px-3 py-2 text-sm font-black shadow-lg',
            snackbar.tone === 'success'
              ? 'border-emerald-500/35 bg-emerald-600 text-white'
              : 'border-red-500/35 bg-red-600 text-white',
          )}
          role="status"
        >
          {snackbar.tone === 'success' ? (
            <CheckCircle2 className="size-4 shrink-0" />
          ) : (
            <CircleAlert className="size-4 shrink-0" />
          )}
          <span className="min-w-0 truncate">{snackbar.message}</span>
        </div>
      ) : null}
    </Card>
  );
}
