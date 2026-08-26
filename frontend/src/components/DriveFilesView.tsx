import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Check,
  ChevronRight,
  CircleCheck,
  Copy,
  Download,
  FileText,
  Folder,
  FolderOpen,
  Grid2X2,
  Home,
  Info,
  List,
  Loader2,
  Pin,
  PinOff,
  RefreshCw,
  Search,
  TriangleAlert,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { appPath } from '../lib/appPath';
import {
  workspaceApi,
  type GoogleDriveFile,
  type GoogleDriveView,
  type GoogleSharedDrive,
} from '../api/workspaceApi';
import { useLanguage } from '../context/LanguageContext';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader } from './ui/card';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from './ui/context-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { Input } from './ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select';
import { Tabs, TabsList, TabsTrigger } from './ui/tabs';
import { WorkspaceIcon } from './WorkspaceIcon';

interface FolderCrumb {
  id: string;
  name: string;
}

type DriveLayout = 'card' | 'list';
type DriveSortOrder = 'ascending' | 'descending' | 'recent' | 'old';
type DriveDownloadStatusType = 'loading' | 'success' | 'error';
type SharedDriveColor = 'default' | 'yellow' | 'blue' | 'green' | 'rose' | 'violet';

interface SharedDrivePreference {
  pinned?: boolean;
  color?: SharedDriveColor;
}

interface DriveFilesViewProps {
  onSelectedItemChange?: (item: GoogleDriveFile | null) => void;
}

interface DriveDownloadStatus {
  type: DriveDownloadStatusType;
  title: string;
  message: string;
}

interface SaveFilePickerHandle {
  createWritable: () => Promise<{
    write: (data: Blob) => Promise<void>;
    close: () => Promise<void>;
  }>;
}

type SaveFilePicker = (options: {
  suggestedName?: string;
}) => Promise<SaveFilePickerHandle>;

type SharedDrivePreferences = Record<string, SharedDrivePreference>;

interface DriveHistorySnapshot {
  source: 'incos-drive-browser';
  activeView: GoogleDriveView;
  folderStack: FolderCrumb[];
  search: string;
  selectedSharedDrive: GoogleSharedDrive | null;
  submittedSearch: string;
}

const sharedDrivePreferenceStorageKey = 'incos-workspace-shared-drive-preferences';
const driveViewValues = ['my-drive', 'shared-drive', 'shared-with-me', 'recent'] as const;

const sharedDriveColorOptions = [
  {
    value: 'default',
    labelKey: 'driveContextColorDefault',
    swatchClassName: 'border-border bg-muted',
    itemClassName: '',
    cardClassName: '',
    selectedItemClassName: 'border-primary bg-primary/15 ring-1 ring-primary',
  },
  {
    value: 'yellow',
    labelKey: 'driveContextColorYellow',
    swatchClassName: 'border-primary/60 bg-primary',
    itemClassName: 'border-primary/45 bg-primary/10 hover:bg-primary/15',
    cardClassName: 'border-primary/45 bg-primary/10 hover:bg-primary/15',
    selectedItemClassName: 'border-primary bg-primary/15 ring-1 ring-primary',
  },
  {
    value: 'blue',
    labelKey: 'driveContextColorBlue',
    swatchClassName: 'border-sky-500/60 bg-sky-500',
    itemClassName: 'border-sky-500/45 bg-sky-500/10 hover:bg-sky-500/15',
    cardClassName: 'border-sky-500/45 bg-sky-500/10 hover:bg-sky-500/15',
    selectedItemClassName: 'border-sky-500 bg-sky-500/15 ring-1 ring-sky-500',
  },
  {
    value: 'green',
    labelKey: 'driveContextColorGreen',
    swatchClassName: 'border-emerald-500/60 bg-emerald-500',
    itemClassName: 'border-emerald-500/45 bg-emerald-500/10 hover:bg-emerald-500/15',
    cardClassName: 'border-emerald-500/45 bg-emerald-500/10 hover:bg-emerald-500/15',
    selectedItemClassName: 'border-emerald-500 bg-emerald-500/15 ring-1 ring-emerald-500',
  },
  {
    value: 'rose',
    labelKey: 'driveContextColorRose',
    swatchClassName: 'border-rose-500/60 bg-rose-500',
    itemClassName: 'border-rose-500/45 bg-rose-500/10 hover:bg-rose-500/15',
    cardClassName: 'border-rose-500/45 bg-rose-500/10 hover:bg-rose-500/15',
    selectedItemClassName: 'border-rose-500 bg-rose-500/15 ring-1 ring-rose-500',
  },
  {
    value: 'violet',
    labelKey: 'driveContextColorViolet',
    swatchClassName: 'border-violet-500/60 bg-violet-500',
    itemClassName: 'border-violet-500/45 bg-violet-500/10 hover:bg-violet-500/15',
    cardClassName: 'border-violet-500/45 bg-violet-500/10 hover:bg-violet-500/15',
    selectedItemClassName: 'border-violet-500 bg-violet-500/15 ring-1 ring-violet-500',
  },
] as const satisfies ReadonlyArray<{
  value: SharedDriveColor;
  labelKey: string;
  swatchClassName: string;
  itemClassName: string;
  cardClassName: string;
  selectedItemClassName: string;
}>;

function readSharedDrivePreferences(): SharedDrivePreferences {
  if (typeof window === 'undefined') {
    return {};
  }

  const stored = window.localStorage.getItem(sharedDrivePreferenceStorageKey);

  if (!stored) {
    return {};
  }

  try {
    return JSON.parse(stored) as SharedDrivePreferences;
  } catch {
    return {};
  }
}

function getSharedDriveColorOption(color?: SharedDriveColor) {
  return sharedDriveColorOptions.find((option) => option.value === color) ?? sharedDriveColorOptions[0];
}

function isDriveHistorySnapshot(value: unknown): value is DriveHistorySnapshot {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const snapshot = value as Partial<DriveHistorySnapshot>;

  return snapshot.source === 'incos-drive-browser'
    && driveViewValues.includes(snapshot.activeView as GoogleDriveView)
    && Array.isArray(snapshot.folderStack);
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return target.isContentEditable
    || target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || target instanceof HTMLSelectElement;
}

function formatFileSize(sizeBytes?: number) {
  if (!sizeBytes) {
    return null;
  }

  if (sizeBytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(sizeBytes / 1024))} KB`;
  }

  return `${(sizeBytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatModifiedDate(value?: string) {
  if (!value) {
    return null;
  }

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function getModifiedTimestamp(file: GoogleDriveFile) {
  if (!file.modifiedTime) {
    return null;
  }

  const timestamp = new Date(file.modifiedTime).getTime();

  return Number.isNaN(timestamp) ? null : timestamp;
}

function compareByName(left: GoogleDriveFile, right: GoogleDriveFile) {
  return left.name.localeCompare(right.name, undefined, {
    numeric: true,
    sensitivity: 'base',
  });
}

function sanitizeDownloadName(fileName: string) {
  return fileName.replace(/[<>:"/\\|?*]+/g, '_').trim() || 'download';
}

function ensureExtension(fileName: string, extension: string) {
  const safeName = sanitizeDownloadName(fileName);

  return safeName.toLowerCase().endsWith(extension) ? safeName : `${safeName}${extension}`;
}

function getSuggestedDownloadName(file: GoogleDriveFile) {
  if (file.isFolder) {
    return ensureExtension(file.name, '.zip');
  }

  const exportExtensions: Record<string, string> = {
    'application/vnd.google-apps.document': '.docx',
    'application/vnd.google-apps.spreadsheet': '.xlsx',
    'application/vnd.google-apps.presentation': '.pptx',
    'application/vnd.google-apps.drawing': '.pdf',
    'application/vnd.google-apps.script': '.json',
  };
  const exportExtension = exportExtensions[file.mimeType];

  return exportExtension ? ensureExtension(file.name, exportExtension) : sanitizeDownloadName(file.name);
}

const viewIcons: Record<GoogleDriveView, string> = {
  'my-drive': 'google-drive',
  'shared-drive': 'users',
  'shared-with-me': 'link',
  recent: 'clock',
};

export function DriveFilesView({ onSelectedItemChange }: DriveFilesViewProps) {
  const { dictionary } = useLanguage();
  const isMountedRef = useRef(true);
  const downloadStatusTimeoutRef = useRef<number | null>(null);
  const searchPreviewCloseTimeoutRef = useRef<number | null>(null);
  const objectUrlRevokeTimeoutsRef = useRef<Array<{ timeoutId: number; url: string }>>([]);
  const [activeView, setActiveView] = useState<GoogleDriveView>('my-drive');
  const [files, setFiles] = useState<GoogleDriveFile[]>([]);
  const [sharedDrives, setSharedDrives] = useState<GoogleSharedDrive[]>([]);
  const [sharedDrivesError, setSharedDrivesError] = useState<string | null>(null);
  const [selectedSharedDrive, setSelectedSharedDrive] = useState<GoogleSharedDrive | null>(null);
  const [folderStack, setFolderStack] = useState<FolderCrumb[]>([]);
  const [selectedFile, setSelectedFile] = useState<GoogleDriveFile | null>(null);
  const [layout, setLayout] = useState<DriveLayout>('list');
  const [sortOrder, setSortOrder] = useState<DriveSortOrder>('ascending');
  const [search, setSearch] = useState('');
  const [submittedSearch, setSubmittedSearch] = useState('');
  const [isSearchPreviewOpen, setIsSearchPreviewOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [downloadStatus, setDownloadStatus] = useState<DriveDownloadStatus | null>(null);
  const [flaggedDownloadFile, setFlaggedDownloadFile] = useState<GoogleDriveFile | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [sharedDrivePreferences, setSharedDrivePreferences] = useState<SharedDrivePreferences>(
    readSharedDrivePreferences,
  );

  const createHistorySnapshot = (overrides: Partial<DriveHistorySnapshot> = {}): DriveHistorySnapshot => ({
    source: 'incos-drive-browser',
    activeView,
    folderStack,
    search,
    selectedSharedDrive,
    submittedSearch,
    ...overrides,
  });

  const pushDriveHistory = (overrides: Partial<DriveHistorySnapshot> = {}) => {
    window.history.pushState(createHistorySnapshot(overrides), '', window.location.href);
  };

  const currentFolder = folderStack.at(-1);
  const canLoadFiles = activeView !== 'shared-drive' || Boolean(selectedSharedDrive);
  const rootLabel = activeView === 'shared-drive'
    ? (selectedSharedDrive?.name ?? dictionary.sharedDrives)
    : dictionary.driveBreadcrumbRoot;
  const tabs = useMemo(
    () => [
      { value: 'my-drive' as const, label: dictionary.myDrive },
      { value: 'shared-drive' as const, label: dictionary.sharedDrives },
      { value: 'shared-with-me' as const, label: dictionary.sharedWithMe },
      { value: 'recent' as const, label: dictionary.recentDocuments },
    ],
    [dictionary.myDrive, dictionary.recentDocuments, dictionary.sharedDrives, dictionary.sharedWithMe],
  );
  const sortOptions = useMemo(
    () => [
      { value: 'ascending' as const, label: dictionary.driveSortAscending },
      { value: 'descending' as const, label: dictionary.driveSortDescending },
      { value: 'recent' as const, label: dictionary.driveSortRecent },
      { value: 'old' as const, label: dictionary.driveSortOld },
    ],
    [
      dictionary.driveSortAscending,
      dictionary.driveSortDescending,
      dictionary.driveSortOld,
      dictionary.driveSortRecent,
    ],
  );

  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;

      if (downloadStatusTimeoutRef.current !== null) {
        window.clearTimeout(downloadStatusTimeoutRef.current);
      }

      if (searchPreviewCloseTimeoutRef.current !== null) {
        window.clearTimeout(searchPreviewCloseTimeoutRef.current);
      }

      objectUrlRevokeTimeoutsRef.current.forEach(({ timeoutId, url }) => {
        window.clearTimeout(timeoutId);
        URL.revokeObjectURL(url);
      });
      objectUrlRevokeTimeoutsRef.current = [];
    };
  }, []);
  const orderedSharedDrives = useMemo(
    () =>
      [...sharedDrives].sort((left, right) => {
        const leftPinned = sharedDrivePreferences[left.id]?.pinned ? 1 : 0;
        const rightPinned = sharedDrivePreferences[right.id]?.pinned ? 1 : 0;

        if (leftPinned !== rightPinned) {
          return rightPinned - leftPinned;
        }

        return left.name.localeCompare(right.name);
      }),
    [sharedDrivePreferences, sharedDrives],
  );
  const orderedFiles = useMemo(
    () =>
      [...files].sort((left, right) => {
        if (sortOrder === 'ascending') {
          return compareByName(left, right);
        }

        if (sortOrder === 'descending') {
          return compareByName(right, left);
        }

        const leftTimestamp = getModifiedTimestamp(left);
        const rightTimestamp = getModifiedTimestamp(right);

        if (leftTimestamp === null && rightTimestamp === null) {
          return compareByName(left, right);
        }

        if (leftTimestamp === null) {
          return 1;
        }

        if (rightTimestamp === null) {
          return -1;
        }

        const dateComparison =
          sortOrder === 'recent'
            ? rightTimestamp - leftTimestamp
            : leftTimestamp - rightTimestamp;

        return dateComparison || compareByName(left, right);
      }),
    [files, sortOrder],
  );
  const searchSuggestions = useMemo(() => {
    const query = search.trim().toLowerCase();

    if (!query) {
      return [];
    }

    return orderedFiles
      .filter((file) => file.name.toLowerCase().includes(query))
      .slice(0, 6);
  }, [orderedFiles, search]);

  useEffect(() => {
    window.localStorage.setItem(sharedDrivePreferenceStorageKey, JSON.stringify(sharedDrivePreferences));
  }, [sharedDrivePreferences]);

  useEffect(() => {
    onSelectedItemChange?.(selectedFile);
  }, [onSelectedItemChange, selectedFile]);

  useEffect(() => {
    const applySnapshot = (snapshot: DriveHistorySnapshot) => {
      setActiveView(snapshot.activeView);
      setSelectedSharedDrive(snapshot.selectedSharedDrive ?? null);
      setFolderStack(snapshot.folderStack);
      setSearch(snapshot.search ?? '');
      setSubmittedSearch(snapshot.submittedSearch ?? '');
      setIsSearchPreviewOpen(false);
      setSelectedFile(null);
      setFiles([]);
      setError(null);
      setIsLoading(true);
    };

    if (isDriveHistorySnapshot(window.history.state)) {
      applySnapshot(window.history.state);
    } else {
      window.history.replaceState(
        {
          source: 'incos-drive-browser',
          activeView: 'my-drive',
          folderStack: [],
          search: '',
          selectedSharedDrive: null,
          submittedSearch: '',
        } satisfies DriveHistorySnapshot,
        '',
        window.location.href,
      );
    }

    const handlePopState = (event: PopStateEvent) => {
      if (isDriveHistorySnapshot(event.state)) {
        applySnapshot(event.state);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) {
        return;
      }

      const previousShortcut =
        event.key === 'BrowserBack'
        || (event.altKey && event.key === 'ArrowLeft')
        || (event.metaKey && event.key === '[');
      const nextShortcut =
        event.key === 'BrowserForward'
        || (event.altKey && event.key === 'ArrowRight')
        || (event.metaKey && event.key === ']');

      if (previousShortcut) {
        event.preventDefault();
        window.history.back();
      }

      if (nextShortcut) {
        event.preventDefault();
        window.history.forward();
      }
    };

    window.addEventListener('popstate', handlePopState);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('popstate', handlePopState);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const clearSearchState = () => {
    setSearch('');
    setSubmittedSearch('');
    setIsSearchPreviewOpen(false);
  };

  const loadFiles = (options?: {
    view?: GoogleDriveView;
    folderId?: string;
    driveId?: string;
    search?: string;
  }) => {
    const requestView = options?.view ?? activeView;

    setIsLoading(true);
    setError(null);

    workspaceApi
      .getGoogleDriveBrowser({
        view: requestView,
        folderId: options?.folderId ?? currentFolder?.id,
        driveId: requestView === 'shared-drive' ? (options?.driveId ?? selectedSharedDrive?.id) : undefined,
        search: options?.search ?? submittedSearch,
      })
      .then((browser) => {
        setFiles(browser.files);
        setSharedDrives(browser.sharedDrives);
        setSharedDrivesError(browser.sharedDrivesError ?? null);
      })
      .catch((nextError: Error) => {
        setFiles([]);
        setSelectedFile(null);
        setError(nextError.message || dictionary.driveConnectRequired);
      })
      .finally(() => setIsLoading(false));
  };

  const submitSearch = (query: string) => {
    const nextSearch = query.trim();
    setSearch(nextSearch);
    setIsSearchPreviewOpen(false);
    setError(null);

    if (nextSearch === submittedSearch) {
      loadFiles({ search: nextSearch });
      return;
    }

    pushDriveHistory({
      search: nextSearch,
      submittedSearch: nextSearch,
    });
    setIsLoading(true);
    setSubmittedSearch(nextSearch);
  };

  const resetSearchAndRefresh = () => {
    clearSearchState();
    setError(null);
    setIsLoading(true);
    setReloadKey((key) => key + 1);
  };

  useEffect(() => {
    let isMounted = true;

    workspaceApi
      .getGoogleDriveBrowser({
        view: activeView,
        folderId: currentFolder?.id,
        driveId: activeView === 'shared-drive' ? selectedSharedDrive?.id : undefined,
        search: submittedSearch,
      })
      .then((browser) => {
        if (isMounted) {
          setFiles(browser.files);
          setSharedDrives(browser.sharedDrives);
          setSharedDrivesError(browser.sharedDrivesError ?? null);
        }
      })
      .catch((nextError: Error) => {
        if (isMounted) {
          setFiles([]);
          setSharedDrivesError(null);
          setSelectedFile(null);
          setError(nextError.message || dictionary.driveConnectRequired);
        }
      })
      .finally(() => {
        if (isMounted) {
          setIsLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [
    activeView,
    currentFolder?.id,
    dictionary.driveConnectRequired,
    reloadKey,
    selectedSharedDrive?.id,
    submittedSearch,
  ]);

  const switchView = (nextView: GoogleDriveView) => {
    pushDriveHistory({
      activeView: nextView,
      folderStack: [],
      search: '',
      selectedSharedDrive: null,
      submittedSearch: '',
    });
    setActiveView(nextView);
    setSelectedSharedDrive(null);
    setFolderStack([]);
    setSelectedFile(null);
    setFiles([]);
    clearSearchState();
    setError(null);
    setIsLoading(true);
  };

  const openSharedDriveChooser = () => {
    pushDriveHistory({
      activeView: 'shared-drive',
      folderStack: [],
      search: '',
      selectedSharedDrive: null,
      submittedSearch: '',
    });
    setActiveView('shared-drive');
    setSelectedSharedDrive(null);
    setFolderStack([]);
    setSelectedFile(null);
    setFiles([]);
    clearSearchState();
    setError(null);
    setIsLoading(true);
    setReloadKey((key) => key + 1);
  };

  const enterFolder = (folder: GoogleDriveFile) => {
    const nextFolderStack = [...folderStack, { id: folder.id, name: folder.name }];

    pushDriveHistory({
      folderStack: nextFolderStack,
    });
    setFolderStack(nextFolderStack);
    setSelectedFile({
      ...folder,
      locationName: folder.locationName ?? currentFolder?.name ?? rootLabel,
    });
    setError(null);
    setIsLoading(true);
  };

  const jumpToCrumb = (index: number) => {
    const nextFolderStack = index < 0 ? [] : folderStack.slice(0, index + 1);

    pushDriveHistory({
      folderStack: nextFolderStack,
      search: '',
      submittedSearch: '',
    });
    setFolderStack(nextFolderStack);
    setSelectedFile(null);
    clearSearchState();
    setError(null);
    setIsLoading(true);
    setReloadKey((key) => key + 1);
  };

  const chooseSharedDrive = (drive: GoogleSharedDrive) => {
    pushDriveHistory({
      activeView: 'shared-drive',
      folderStack: [],
      search: '',
      selectedSharedDrive: drive,
      submittedSearch: '',
    });
    setActiveView('shared-drive');
    setSelectedSharedDrive(drive);
    setFolderStack([]);
    setSelectedFile(null);
    setFiles([]);
    clearSearchState();
    setError(null);
    setIsLoading(true);
  };

  const updateSharedDrivePreference = (
    driveId: string,
    updater: (current: SharedDrivePreference) => SharedDrivePreference,
  ) => {
    setSharedDrivePreferences((currentPreferences) => {
      const currentPreference = currentPreferences[driveId] ?? {};
      const nextPreference = updater(currentPreference);
      const normalizedPreference = {
        ...nextPreference,
        color: nextPreference.color === 'default' ? undefined : nextPreference.color,
      };
      const shouldRemove = !normalizedPreference.pinned && !normalizedPreference.color;

      if (shouldRemove) {
        const remainingPreferences = { ...currentPreferences };
        delete remainingPreferences[driveId];

        return remainingPreferences;
      }

      return {
        ...currentPreferences,
        [driveId]: normalizedPreference,
      };
    });
  };

  const toggleSharedDrivePin = (driveId: string) => {
    updateSharedDrivePreference(driveId, (currentPreference) => ({
      ...currentPreference,
      pinned: !currentPreference.pinned,
    }));
  };

  const setSharedDriveColor = (driveId: string, color: SharedDriveColor) => {
    updateSharedDrivePreference(driveId, (currentPreference) => ({
      ...currentPreference,
      color,
    }));
  };

  const copyDriveValue = async (value: string) => {
    let copied = false;

    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(value);
        copied = true;
      } catch {
        copied = false;
      }
    }

    if (copied) {
      return;
    }

    const textArea = document.createElement('textarea');
    textArea.value = value;
    textArea.setAttribute('readonly', '');
    textArea.style.position = 'fixed';
    textArea.style.left = '-9999px';
    document.body.appendChild(textArea);
    textArea.select();
    document.execCommand('copy');
    document.body.removeChild(textArea);
  };

  const showDownloadStatus = (status: DriveDownloadStatus) => {
    if (!isMountedRef.current) {
      return;
    }

    setDownloadStatus(status);

    if (downloadStatusTimeoutRef.current !== null) {
      window.clearTimeout(downloadStatusTimeoutRef.current);
      downloadStatusTimeoutRef.current = null;
    }

    if (status.type !== 'loading') {
      downloadStatusTimeoutRef.current = window.setTimeout(() => {
        downloadStatusTimeoutRef.current = null;

        if (!isMountedRef.current) {
          return;
        }

        setDownloadStatus((currentStatus) => (currentStatus === status ? null : currentStatus));
      }, 4500);
    }
  };

  const saveBlobWithBrowserDownload = (blob: Blob, fileName: string) => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = url;
    link.download = fileName;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    const timeoutId = window.setTimeout(() => {
      URL.revokeObjectURL(url);
      objectUrlRevokeTimeoutsRef.current = objectUrlRevokeTimeoutsRef.current.filter((entry) => entry.timeoutId !== timeoutId);
    }, 1000);

    objectUrlRevokeTimeoutsRef.current.push({ timeoutId, url });
  };

  const downloadDriveItem = async (
    file: GoogleDriveFile,
    options: { acknowledgeAbuse?: boolean } = {},
  ) => {
    const picker = (window as Window & { showSaveFilePicker?: SaveFilePicker }).showSaveFilePicker;
    let fileHandle: SaveFilePickerHandle | null = null;
    let usedBrowserDownloadFallback = false;

    try {
      if (picker) {
        fileHandle = await picker({
          suggestedName: getSuggestedDownloadName(file),
        });
      }

      showDownloadStatus({
        type: 'loading',
        title: dictionary.driveDownloadPreparing,
        message: file.name,
      });

      const download = await workspaceApi.downloadGoogleDriveItem(file.id, {
        acknowledgeAbuse: options.acknowledgeAbuse,
      });

      if (fileHandle) {
        const writable = await fileHandle.createWritable();
        await writable.write(download.blob);
        await writable.close();
      } else {
        usedBrowserDownloadFallback = true;
        saveBlobWithBrowserDownload(download.blob, download.fileName);
      }

      showDownloadStatus({
        type: 'success',
        title: dictionary.driveDownloadSuccess,
        message: usedBrowserDownloadFallback ? dictionary.driveDownloadFallback : download.fileName,
      });
      if (isMountedRef.current) {
        setFlaggedDownloadFile(null);
      }
    } catch (error) {
      const typedError = error as Error & { googleReason?: string; status?: number };

      if (typedError.name === 'AbortError') {
        showDownloadStatus({
          type: 'error',
          title: dictionary.driveDownloadCancelled,
          message: file.name,
        });
        return;
      }

      if (
        typedError.status === 403
        && typedError.googleReason === 'cannotDownloadAbusiveFile'
        && !options.acknowledgeAbuse
      ) {
        if (isMountedRef.current) {
          setFlaggedDownloadFile(file);
        }
        showDownloadStatus({
          type: 'error',
          title: dictionary.driveDownloadBlockedTitle,
          message: dictionary.driveDownloadBlockedMessage,
        });
        return;
      }

      showDownloadStatus({
        type: 'error',
        title:
          typedError.status === 403
            ? dictionary.driveDownloadPermissionDenied
            : dictionary.driveDownloadFailed,
        message: typedError.message || file.name,
      });
    }
  };

  const handleFilePrimaryAction = (file: GoogleDriveFile) => {
    const fileWithLocation = {
      ...file,
      locationName: currentFolder?.name ?? rootLabel,
    };

    if (file.isFolder) {
      enterFolder(fileWithLocation);
      return;
    }

    setSelectedFile(fileWithLocation);
  };

  const handleSearchTextChange = (value: string) => {
    setSearch(value);
    setIsSearchPreviewOpen(Boolean(value.trim()));

    if (!value.trim() && submittedSearch) {
      setSubmittedSearch('');
      setError(null);
      setIsLoading(true);
    }
  };

  const renderFileIcon = (file: GoogleDriveFile) => (
    <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-background">
      {file.isFolder ? (
        <Folder aria-hidden="true" className="text-primary" size={20} />
      ) : file.iconLink ? (
        <img alt="" className="size-5" src={file.iconLink} />
      ) : (
        <FileText aria-hidden="true" className="text-muted-foreground" size={20} />
      )}
    </div>
  );

  const renderSharedDriveContextMenu = (drive: GoogleSharedDrive, trigger: ReactNode) => {
    const preference = sharedDrivePreferences[drive.id] ?? {};
    const activeColor = preference.color ?? 'default';

    return (
      <ContextMenu key={drive.id}>
        <ContextMenuTrigger asChild>{trigger}</ContextMenuTrigger>
        <ContextMenuContent className="w-60">
          <ContextMenuLabel>{dictionary.driveContextSharedDrive}</ContextMenuLabel>
          <ContextMenuItem onSelect={() => chooseSharedDrive(drive)}>
            <FolderOpen aria-hidden="true" className="size-4" />
            {dictionary.driveContextSelectDrive}
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => toggleSharedDrivePin(drive.id)}>
            {preference.pinned ? (
              <PinOff aria-hidden="true" className="size-4" />
            ) : (
              <Pin aria-hidden="true" className="size-4" />
            )}
            {preference.pinned ? dictionary.driveContextUnpin : dictionary.driveContextPin}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuLabel>{dictionary.driveContextColor}</ContextMenuLabel>
          {sharedDriveColorOptions.map((option) => (
            <ContextMenuItem
              key={option.value}
              onSelect={() => setSharedDriveColor(drive.id, option.value)}
            >
              <span
                aria-hidden="true"
                className={cn('size-3 rounded-full border', option.swatchClassName)}
              />
              <span className="min-w-0 flex-1 truncate">
                {dictionary[option.labelKey as keyof typeof dictionary] as string}
              </span>
              {activeColor === option.value ? <Check aria-hidden="true" className="size-4" /> : null}
            </ContextMenuItem>
          ))}
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={() => void copyDriveValue(drive.name)}>
            <Copy aria-hidden="true" className="size-4" />
            {dictionary.driveContextCopyName}
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => void copyDriveValue(drive.id)}>
            <Copy aria-hidden="true" className="size-4" />
            {dictionary.driveContextCopyId}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    );
  };

  const renderDriveFileContextMenu = (file: GoogleDriveFile, trigger: ReactNode) => (
    <ContextMenu key={file.id}>
      <ContextMenuTrigger asChild>{trigger}</ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        <ContextMenuLabel>
          {file.isFolder ? dictionary.driveContextFolder : dictionary.driveContextFile}
        </ContextMenuLabel>
        {file.isFolder ? (
          <ContextMenuItem onSelect={() => enterFolder(file)}>
            <FolderOpen aria-hidden="true" className="size-4" />
            {dictionary.driveContextBrowseFolder}
          </ContextMenuItem>
        ) : null}
        <ContextMenuItem
          onSelect={() =>
            setSelectedFile({
              ...file,
              locationName: currentFolder?.name ?? rootLabel,
            })
          }
        >
          <Info aria-hidden="true" className="size-4" />
          {dictionary.driveContextViewDetails}
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => void downloadDriveItem(file)}>
          <Download aria-hidden="true" className="size-4" />
          {dictionary.driveContextDownload}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => void copyDriveValue(file.name)}>
          <Copy aria-hidden="true" className="size-4" />
          {dictionary.driveContextCopyName}
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => void copyDriveValue(file.id)}>
          <Copy aria-hidden="true" className="size-4" />
          {dictionary.driveContextCopyId}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => loadFiles()}>
          <RefreshCw aria-hidden="true" className="size-4" />
          {dictionary.driveContextRefreshFolder}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );

  const renderSharedDrivePicker = () => (
    <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
      {orderedSharedDrives.map((drive) => {
        const preference = sharedDrivePreferences[drive.id] ?? {};
        const colorOption = getSharedDriveColorOption(preference.color);

        return renderSharedDriveContextMenu(
          drive,
          <button
            className={cn(
              'rounded-lg border bg-muted/20 p-4 text-left transition hover:bg-muted/45',
              colorOption.cardClassName,
              preference.pinned && 'ring-1 ring-primary/45',
            )}
            onClick={() => chooseSharedDrive(drive)}
            title={drive.name}
            type="button"
          >
            <div className="flex items-center gap-3">
              <div className="grid size-10 place-items-center rounded-lg bg-background">
                <WorkspaceIcon name="users" size={19} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-black">{drive.name}</div>
                <div className="mt-1 flex items-center gap-1.5 text-xs font-bold text-muted-foreground">
                  <span className={cn('size-2.5 rounded-full border', colorOption.swatchClassName)} />
                  <span>{dictionary.sharedDrives}</span>
                </div>
              </div>
              {preference.pinned ? <Pin aria-hidden="true" className="size-4 shrink-0 text-primary" /> : null}
            </div>
          </button>,
        );
      })}
    </div>
  );

  return (
    <Card className="rounded-xl bg-card shadow-none">
      <Dialog
        onOpenChange={(open) => {
          if (!open) {
            setFlaggedDownloadFile(null);
          }
        }}
        open={Boolean(flaggedDownloadFile)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{dictionary.driveDownloadConfirmAbuseTitle}</DialogTitle>
            <DialogDescription>{dictionary.driveDownloadConfirmAbuseDescription}</DialogDescription>
          </DialogHeader>
          {flaggedDownloadFile ? (
            <div className="rounded-lg border bg-muted/40 p-3 text-sm font-bold">
              {flaggedDownloadFile.name}
            </div>
          ) : null}
          <DialogFooter>
            <Button
              onClick={() => setFlaggedDownloadFile(null)}
              type="button"
              variant="outline"
            >
              {dictionary.cancel}
            </Button>
            <Button
              onClick={() => {
                const file = flaggedDownloadFile;

                setFlaggedDownloadFile(null);

                if (file) {
                  void downloadDriveItem(file, { acknowledgeAbuse: true });
                }
              }}
              type="button"
            >
              {dictionary.driveDownloadAnyway}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {downloadStatus ? (
        <div
          className={cn(
            'fixed bottom-4 right-4 z-50 flex w-[min(360px,calc(100vw-2rem))] items-start gap-3 rounded-xl border bg-popover p-3 text-popover-foreground shadow-lg ring-1 ring-foreground/10',
            downloadStatus.type === 'success' && 'border-emerald-500/45',
            downloadStatus.type === 'error' && 'border-destructive/45',
          )}
          role="status"
        >
          <div
            className={cn(
              'mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-muted',
              downloadStatus.type === 'success' && 'bg-emerald-500/15 text-emerald-600',
              downloadStatus.type === 'error' && 'bg-destructive/15 text-destructive',
              downloadStatus.type === 'loading' && 'bg-primary/15 text-primary',
            )}
          >
            {downloadStatus.type === 'loading' ? (
              <Loader2 aria-hidden="true" className="size-4 animate-spin" />
            ) : downloadStatus.type === 'success' ? (
              <CircleCheck aria-hidden="true" className="size-4" />
            ) : (
              <TriangleAlert aria-hidden="true" className="size-4" />
            )}
          </div>
          <div className="min-w-0">
            <div className="text-sm font-black">{downloadStatus.title}</div>
            <div className="mt-1 break-words text-xs font-bold text-muted-foreground">
              {downloadStatus.message}
            </div>
          </div>
        </div>
      ) : null}
      <CardHeader className="gap-3">
        <div className="grid gap-2 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-center">
          <Tabs className="min-w-0" onValueChange={(value) => switchView(value as GoogleDriveView)} value={activeView}>
            <TabsList className="flex min-h-12 w-fit max-w-full flex-wrap items-center justify-start gap-1.5 rounded-lg border bg-muted p-1.5">
              {tabs.map((tab) => (
                <TabsTrigger
                  className="h-9 w-auto flex-none justify-start overflow-hidden rounded-md px-3 text-xs font-black shadow-none data-active:shadow-none sm:text-sm"
                  key={tab.value}
                  onClick={() => {
                    if (tab.value === 'shared-drive' && activeView === 'shared-drive') {
                      openSharedDriveChooser();
                    }
                  }}
                  value={tab.value}
                >
                  <WorkspaceIcon className="size-4 shrink-0" name={viewIcons[tab.value]} size={18} />
                  <span className="min-w-0 truncate">{tab.label}</span>
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          <div className="flex items-center justify-end gap-2">
            <Select onValueChange={(value) => setSortOrder(value as DriveSortOrder)} value={sortOrder}>
              <SelectTrigger
                aria-label={dictionary.driveSortOrder}
                className="h-9 w-[142px] rounded-lg bg-muted font-black"
              >
                <SelectValue placeholder={dictionary.driveSortOrder} />
              </SelectTrigger>
              <SelectContent>
                {sortOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex rounded-lg border bg-muted p-1">
              <Button
                aria-label={dictionary.cardView}
                className="h-8 rounded-md px-2"
                onClick={() => setLayout('card')}
                type="button"
                variant={layout === 'card' ? 'secondary' : 'ghost'}
              >
                <Grid2X2 aria-hidden="true" className="size-4" />
              </Button>
              <Button
                aria-label={dictionary.listView}
                className="h-8 rounded-md px-2"
                onClick={() => setLayout('list')}
                type="button"
                variant={layout === 'list' ? 'secondary' : 'ghost'}
              >
                <List aria-hidden="true" className="size-4" />
              </Button>
            </div>
            <Button
              className="h-9 rounded-lg font-black"
              onClick={resetSearchAndRefresh}
              type="button"
              variant="outline"
            >
              <RefreshCw aria-hidden="true" className="size-4" />
              <span>{dictionary.driveRefresh}</span>
            </Button>
          </div>
        </div>

        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            submitSearch(search);
          }}
        >
          <div className="relative min-w-0 flex-1">
            <Search
              aria-hidden="true"
              className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              className="h-10 rounded-lg pl-9"
              onBlur={() => {
                if (searchPreviewCloseTimeoutRef.current !== null) {
                  window.clearTimeout(searchPreviewCloseTimeoutRef.current);
                }

                searchPreviewCloseTimeoutRef.current = window.setTimeout(() => {
                  searchPreviewCloseTimeoutRef.current = null;

                  if (isMountedRef.current) {
                    setIsSearchPreviewOpen(false);
                  }
                }, 120);
              }}
              onChange={(event) => handleSearchTextChange(event.target.value)}
              onFocus={() => setIsSearchPreviewOpen(Boolean(search.trim()))}
              placeholder={dictionary.driveSearchPlaceholder}
              value={search}
            />
            {isSearchPreviewOpen ? (
              <div className="absolute left-0 right-0 top-12 z-40 overflow-hidden rounded-xl border bg-popover p-2 text-popover-foreground shadow-md ring-1 ring-foreground/10">
                <div className="mb-2 flex items-center justify-between gap-2 px-2 text-[11px] font-black uppercase text-muted-foreground">
                  <span>{dictionary.driveSearchSuggestions}</span>
                  <span>{dictionary.driveSearchSubmitHint}</span>
                </div>
                {searchSuggestions.length > 0 ? (
                  <div className="grid max-h-72 gap-1 overflow-y-auto">
                    {searchSuggestions.map((file) => {
                      const modified = formatModifiedDate(file.modifiedTime);
                      const size = formatFileSize(file.sizeBytes);

                      return (
                        <button
                          className="flex min-w-0 items-center gap-3 rounded-lg px-2 py-2 text-left transition hover:bg-muted"
                          key={file.id}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => {
                            setIsSearchPreviewOpen(false);
                            setSearch(file.name);
                            handleFilePrimaryAction(file);
                          }}
                          type="button"
                        >
                          {renderFileIcon(file)}
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-black">{file.name}</div>
                            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs font-bold text-muted-foreground">
                              <span>{file.isFolder ? dictionary.folder : dictionary.file}</span>
                              {modified ? <span>{modified}</span> : null}
                              {size ? <span>{size}</span> : null}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="rounded-lg bg-muted/35 px-3 py-3 text-xs font-bold text-muted-foreground">
                    {dictionary.driveSearchSubmitHint}
                  </div>
                )}
              </div>
            ) : null}
          </div>
          <Button className="h-10 rounded-lg font-black" type="submit">
            <Search aria-hidden="true" className="size-4" />
          </Button>
        </form>

        <div className="flex flex-wrap items-center gap-1 rounded-lg border bg-muted/25 p-2">
          <Button
            className="h-7 max-w-[280px] rounded-md px-2 text-xs font-black"
            onClick={() => jumpToCrumb(-1)}
            type="button"
            variant={folderStack.length === 0 ? 'secondary' : 'ghost'}
          >
            <Home aria-hidden="true" className="size-3.5 shrink-0" />
            <span className="truncate">{rootLabel}</span>
          </Button>
          {folderStack.map((crumb, index) => (
            <div className="flex min-w-0 items-center gap-1" key={crumb.id}>
              <ChevronRight aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
              <Button
                className="h-7 max-w-[220px] rounded-md px-2 text-xs font-black"
                onClick={() => jumpToCrumb(index)}
                type="button"
                variant={index === folderStack.length - 1 ? 'secondary' : 'ghost'}
              >
                <span className="truncate">{crumb.name}</span>
              </Button>
            </div>
          ))}
        </div>
      </CardHeader>

      <CardContent className="grid min-h-[640px] gap-3 xl:h-[calc(100vh-260px)] xl:min-h-[560px] xl:grid-cols-[320px_minmax(0,1fr)] 2xl:grid-cols-[340px_minmax(0,1fr)]">
        <div className="min-h-0 min-w-0 rounded-lg border bg-muted/20 p-3">
          <h3 className="mb-3 text-sm font-black">{dictionary.sharedDrives}</h3>
          <div className="grid max-h-[520px] min-w-0 gap-2 overflow-y-auto pr-1 xl:max-h-[calc(100%-32px)]">
            {sharedDrivesError ? (
              <p className="text-xs font-bold text-destructive">{sharedDrivesError}</p>
            ) : null}
            {!sharedDrivesError && sharedDrives.length === 0 ? (
              <p className="text-xs font-bold text-muted-foreground">{dictionary.driveChooseSharedDrive}</p>
            ) : null}
            {orderedSharedDrives.map((drive) => {
              const preference = sharedDrivePreferences[drive.id] ?? {};
              const colorOption = getSharedDriveColorOption(preference.color);
              const isSelectedSharedDrive = selectedSharedDrive?.id === drive.id;

              return renderSharedDriveContextMenu(
                drive,
                <Button
                  className={cn(
                    'h-auto min-w-0 justify-start rounded-lg border px-3 py-2 text-left text-xs font-bold',
                    colorOption.itemClassName,
                    isSelectedSharedDrive && colorOption.selectedItemClassName,
                    preference.pinned && !isSelectedSharedDrive && 'ring-1 ring-primary/45',
                  )}
                  onClick={() => chooseSharedDrive(drive)}
                  title={drive.name}
                  type="button"
                  variant={isSelectedSharedDrive ? 'secondary' : 'ghost'}
                >
                  <WorkspaceIcon className="shrink-0" name="users" size={15} />
                  <span className={cn('size-2 rounded-full border', colorOption.swatchClassName)} />
                  <span className="block min-w-0 flex-1 truncate">{drive.name}</span>
                  {preference.pinned ? <Pin aria-hidden="true" className="size-3.5 shrink-0 text-primary" /> : null}
                </Button>,
              );
            })}
          </div>
        </div>

        <div className="min-h-0 min-w-0 overflow-y-auto pr-1">
          {isLoading ? (
            <div className="grid h-full min-h-[520px] place-items-center rounded-lg border bg-muted/25">
              <div className="inline-flex items-center gap-2 text-sm font-bold text-muted-foreground">
                <Loader2 aria-hidden="true" className="size-4 animate-spin" />
                {dictionary.driveLoading}
              </div>
            </div>
          ) : null}

          {!isLoading && error ? (
            <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4">
              <p className="text-sm font-bold text-destructive">{error}</p>
              <Button asChild className="mt-4 h-9 rounded-lg font-black" type="button">
                <a href={appPath('/api/google/integrations/google_drive/connect')}>
                  <WorkspaceIcon name="google-drive" size={16} />
                  <span>{dictionary.connectGoogleDrive}</span>
                </a>
              </Button>
            </div>
          ) : null}

          {!isLoading && !error && activeView === 'shared-drive' && !selectedSharedDrive ? (
            sharedDrives.length > 0 ? renderSharedDrivePicker() : (
              <div className="grid h-full min-h-[420px] place-items-center rounded-lg border bg-muted/25 text-sm font-bold text-muted-foreground">
                {dictionary.driveChooseSharedDrive}
              </div>
            )
          ) : null}

          {!isLoading && !error && canLoadFiles && files.length === 0 ? (
            <div className="grid h-full min-h-[420px] place-items-center rounded-lg border bg-muted/25 text-sm font-bold text-muted-foreground">
              {dictionary.driveNoFiles}
            </div>
          ) : null}

          {!isLoading && !error && orderedFiles.length > 0 ? (
            <div className={layout === 'card' ? 'grid gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4' : 'grid gap-2'}>
              {orderedFiles.map((file) => {
                const modified = formatModifiedDate(file.modifiedTime);
                const size = formatFileSize(file.sizeBytes);
                const isSelected = selectedFile?.id === file.id;

                if (layout === 'list') {
                  return renderDriveFileContextMenu(
                    file,
                    <button
                      className={`flex items-center gap-3 rounded-lg border bg-muted/20 p-3 text-left transition hover:bg-muted/45 ${
                        isSelected ? 'border-primary bg-primary/10' : ''
                      }`}
                      onClick={() => handleFilePrimaryAction(file)}
                      type="button"
                    >
                      {renderFileIcon(file)}
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-black">{file.name}</div>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs font-bold text-muted-foreground">
                          <span>{file.isFolder ? dictionary.folder : dictionary.file}</span>
                          {modified ? <span>{modified}</span> : null}
                          {size ? <span>{size}</span> : null}
                        </div>
                      </div>
                    </button>,
                  );
                }

                return renderDriveFileContextMenu(
                  file,
                  <button
                    className={`rounded-lg border bg-muted/20 p-4 text-left transition hover:bg-muted/45 ${
                      isSelected ? 'border-primary bg-primary/10' : ''
                    }`}
                    onClick={() => handleFilePrimaryAction(file)}
                    type="button"
                  >
                    <div className="flex items-start gap-3">
                      {renderFileIcon(file)}
                      <div className="min-w-0 flex-1">
                        <h3 className="line-clamp-2 text-sm font-black leading-snug">{file.name}</h3>
                        <div className="mt-2 flex flex-wrap gap-1">
                          <Badge variant="outline">{file.isFolder ? dictionary.folder : dictionary.file}</Badge>
                          {size ? <Badge variant="secondary">{size}</Badge> : null}
                        </div>
                      </div>
                    </div>
                    <div className="mt-4 truncate text-xs font-bold text-muted-foreground">{modified}</div>
                  </button>,
                );
              })}
            </div>
          ) : null}
        </div>

      </CardContent>
    </Card>
  );
}
