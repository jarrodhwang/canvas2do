import { useMemo, useState } from 'react';
import { Copy, FileText, Folder, Link, Lock, Share2, Users } from 'lucide-react';
import {
  workspaceApi,
  type GoogleDriveFile,
  type GoogleDrivePermission,
} from '../api/workspaceApi';
import { useLanguage } from '../context/LanguageContext';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Card, CardContent } from './ui/card';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { Separator } from './ui/separator';

interface DriveDetailPanelProps {
  item: GoogleDriveFile | null;
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

function formatDriveDate(value?: string) {
  if (!value) {
    return null;
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function getInitials(name?: string | null, email?: string | null) {
  const source = name || email || '?';
  const parts = source.trim().split(/\s+/).filter(Boolean);

  if (parts.length === 0) {
    return '?';
  }

  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }

  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

function getFriendlyFileType(item: GoogleDriveFile, dictionary: ReturnType<typeof useLanguage>['dictionary']) {
  if (item.isFolder) {
    return dictionary.folder;
  }

  const mimeTypeLabels: Record<string, string> = {
    'application/pdf': 'PDF',
    'text/plain': 'Text',
    'text/csv': 'CSV',
    'application/zip': 'ZIP',
    'application/json': 'JSON',
    'image/png': 'PNG image',
    'image/jpeg': 'JPEG image',
    'image/gif': 'GIF image',
    'image/webp': 'WebP image',
    'application/vnd.google-apps.document': 'Google Docs',
    'application/vnd.google-apps.spreadsheet': 'Google Sheets',
    'application/vnd.google-apps.presentation': 'Google Slides',
    'application/vnd.google-apps.drawing': 'Google Drawing',
    'application/vnd.google-apps.form': 'Google Form',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'Microsoft Word',
    'application/msword': 'Microsoft Word',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'Microsoft Excel',
    'application/vnd.ms-excel': 'Microsoft Excel',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'Microsoft PowerPoint',
    'application/vnd.ms-powerpoint': 'Microsoft PowerPoint',
  };

  return mimeTypeLabels[item.mimeType] ?? item.name.split('.').at(-1)?.toUpperCase() ?? dictionary.file;
}

function getPreviewUrl(item: GoogleDriveFile) {
  if (item.isFolder) {
    return null;
  }

  const previewRoutes: Record<string, string> = {
    'application/vnd.google-apps.document': `https://docs.google.com/document/d/${item.id}/preview`,
    'application/vnd.google-apps.spreadsheet': `https://docs.google.com/spreadsheets/d/${item.id}/preview`,
    'application/vnd.google-apps.presentation': `https://docs.google.com/presentation/d/${item.id}/preview`,
    'application/vnd.google-apps.drawing': `https://docs.google.com/drawings/d/${item.id}/preview`,
  };

  return previewRoutes[item.mimeType] ?? `https://drive.google.com/file/d/${item.id}/preview`;
}

export function DriveDetailPanel({ item }: DriveDetailPanelProps) {
  const { dictionary } = useLanguage();
  const [isAccessOpen, setIsAccessOpen] = useState(false);
  const [permissions, setPermissions] = useState<GoogleDrivePermission[]>([]);
  const [permissionsError, setPermissionsError] = useState<string | null>(null);
  const [isPermissionsLoading, setIsPermissionsLoading] = useState(false);
  const [isLinkCopied, setIsLinkCopied] = useState(false);
  const fileType = item ? getFriendlyFileType(item, dictionary) : dictionary.file;
  const previewUrl = item ? getPreviewUrl(item) : null;
  const locationLabel = item?.locationName ?? item?.parentNames?.[0] ?? dictionary.driveBreadcrumbRoot;
  const generalAccess = permissions.find((permission) => permission.type === 'anyone' || permission.type === 'domain');
  const userPermissions = useMemo(
    () => permissions.filter((permission) => permission.type !== 'anyone' && permission.type !== 'domain'),
    [permissions],
  );

  const loadPermissions = (fileId: string) => {
    setIsPermissionsLoading(true);
    setPermissionsError(null);

    workspaceApi
      .getGoogleDrivePermissions(fileId)
      .then((response) => {
        setPermissions(response.permissions);
      })
      .catch((error: Error) => {
        setPermissions([]);
        setPermissionsError(error.message || dictionary.driveAccessUnavailable);
      })
      .finally(() => setIsPermissionsLoading(false));
  };

  const openAccessDialog = () => {
    if (!item) {
      return;
    }

    setIsAccessOpen(true);
    setPermissions([]);
    loadPermissions(item.id);
  };

  const copyShareLink = async () => {
    if (!item?.webViewLink) {
      return;
    }

    await navigator.clipboard?.writeText(item.webViewLink);
    setIsLinkCopied(true);
    window.setTimeout(() => setIsLinkCopied(false), 1800);
  };

  const getRoleLabel = (role: string) => {
    const roleLabels: Record<string, string> = {
      owner: dictionary.driveOwnerRole,
      organizer: dictionary.driveOrganizerRole,
      fileOrganizer: dictionary.driveFileOrganizerRole,
      writer: dictionary.driveWriterRole,
      commenter: dictionary.driveCommenterRole,
      reader: dictionary.driveReaderRole,
    };

    return roleLabels[role] ?? role;
  };

  const getTypeLabel = (type: string) => {
    const typeLabels: Record<string, string> = {
      user: dictionary.driveUserType,
      group: dictionary.driveGroupType,
      domain: dictionary.driveDomainType,
      anyone: dictionary.driveAnyoneType,
    };

    return typeLabels[type] ?? type;
  };

  return (
    <Card className="sticky top-[92px] min-h-[calc(100vh-110px)] w-full min-w-0 self-start overflow-hidden rounded-xl bg-card p-4 shadow-none xl:static xl:h-full xl:min-h-0 xl:self-stretch xl:overflow-y-auto max-xl:static max-xl:col-span-2 max-xl:min-h-0">
      <div className="mb-4 rounded-xl border bg-muted/45 p-4">
        <div className="mb-4 grid size-12 place-items-center rounded-xl bg-background">
          {item ? (
            item.isFolder ? (
              <Folder aria-hidden="true" className="text-primary" size={24} />
            ) : item.iconLink ? (
              <img alt="" className="size-6" src={item.iconLink} />
            ) : (
              <FileText aria-hidden="true" className="text-muted-foreground" size={24} />
            )
          ) : (
            <FileText aria-hidden="true" className="text-muted-foreground" size={24} />
          )}
        </div>
        <Badge className="mb-3 bg-primary text-primary-foreground hover:bg-primary" variant="secondary">
          {item ? fileType : dictionary.driveDetailsTitle}
        </Badge>
        <h2 className="break-words text-xl font-black leading-tight">
          {item?.name ?? dictionary.driveDetailsTitle}
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {item ? dictionary.driveNoExternalOpen : dictionary.driveSelectFile}
        </p>
      </div>

      {item ? (
        <CardContent className="space-y-4 px-0 pb-0">
          <div className="grid grid-cols-2 gap-2">
            <Button
              className="h-9 rounded-lg font-black"
              disabled={!item.webViewLink}
              onClick={() => void copyShareLink()}
              type="button"
              variant="outline"
            >
              <Share2 aria-hidden="true" className="size-4" />
              {isLinkCopied ? dictionary.driveLinkCopied : dictionary.driveShare}
            </Button>
            <Button
              className="h-9 rounded-lg font-black"
              onClick={openAccessDialog}
              type="button"
              variant="outline"
            >
              <Users aria-hidden="true" className="size-4" />
              {dictionary.driveAccess}
            </Button>
          </div>

          <section>
            <h3 className="mb-2 text-[11px] font-black uppercase text-muted-foreground">
              {dictionary.drivePreview}
            </h3>
            <div className="overflow-hidden rounded-lg border bg-muted/25">
              {previewUrl ? (
                <iframe
                  className="h-52 w-full bg-background"
                  src={previewUrl}
                  title={item.name}
                />
              ) : (
                <div className="grid h-52 place-items-center p-4 text-center text-sm font-bold text-muted-foreground">
                  {dictionary.notSet}
                </div>
              )}
            </div>
          </section>

          <section>
            <h3 className="mb-2 text-[11px] font-black uppercase text-muted-foreground">
              {dictionary.mainInfo}
            </h3>
            <div className="grid grid-cols-2 gap-2 max-sm:grid-cols-1">
              <div className="rounded-lg border bg-muted/35 p-3">
                <span className="block text-[11px] font-black uppercase text-muted-foreground">
                  {dictionary.driveItemKind}
                </span>
                <strong className="mt-1 block text-sm">{fileType}</strong>
              </div>
              <div className="rounded-lg border bg-muted/35 p-3">
                <span className="block text-[11px] font-black uppercase text-muted-foreground">
                  {dictionary.driveFileSize}
                </span>
                <strong className="mt-1 block text-sm">
                  {formatFileSize(item.sizeBytes) ?? dictionary.notSet}
                </strong>
              </div>
              <div className="rounded-lg border bg-muted/35 p-3 sm:col-span-2">
                <span className="block text-[11px] font-black uppercase text-muted-foreground">
                  {dictionary.driveLocation}
                </span>
                <strong className="mt-1 block break-words text-sm">{locationLabel}</strong>
              </div>
            </div>
          </section>

          <Separator />

          <section>
            <h3 className="mb-2 text-[11px] font-black uppercase text-muted-foreground">
              {dictionary.driveTechnicalInfo}
            </h3>
            <div className="space-y-2">
              <div className="rounded-lg border bg-muted/35 p-3">
                <div className="text-[11px] font-black uppercase text-muted-foreground">
                  {dictionary.modified}
                </div>
                <div className="mt-1 font-bold text-muted-foreground">
                  {formatDriveDate(item.modifiedTime) ?? dictionary.notSet}
                </div>
              </div>
              <div className="rounded-lg border bg-muted/35 p-3">
                <div className="text-[11px] font-black uppercase text-muted-foreground">
                  {dictionary.driveCreated}
                </div>
                <div className="mt-1 font-bold text-muted-foreground">
                  {formatDriveDate(item.createdTime) ?? dictionary.notSet}
                </div>
              </div>
            </div>
          </section>
        </CardContent>
      ) : (
        <div className="grid min-h-[320px] place-items-center rounded-xl border border-dashed bg-muted/20 p-6 text-center text-sm font-bold text-muted-foreground">
          {dictionary.driveSelectFile}
        </div>
      )}

      <Dialog onOpenChange={setIsAccessOpen} open={isAccessOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{dictionary.driveAccessTitle}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <h3 className="break-words text-lg font-black">{item?.name}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{dictionary.driveAccessDescription}</p>
            </div>
            {permissionsError ? (
              <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm font-bold text-destructive">
                {permissionsError}
              </div>
            ) : null}
            <section>
              <h4 className="mb-2 text-sm font-black">{dictionary.driveAccessUsers}</h4>
              <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
                {isPermissionsLoading ? (
                  <div className="rounded-lg border bg-muted/35 p-3 text-sm font-bold text-muted-foreground">
                    {dictionary.driveLoading}
                  </div>
                ) : null}
                {!isPermissionsLoading && userPermissions.length === 0 ? (
                  <div className="rounded-lg border bg-muted/35 p-3 text-sm font-bold text-muted-foreground">
                    {dictionary.notSet}
                  </div>
                ) : null}
                {userPermissions.map((permission) => (
                  <div className="flex items-center gap-3 rounded-lg border bg-muted/25 p-2" key={permission.id}>
                    <div className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-full bg-primary/15 text-xs font-black text-primary">
                      {permission.photoLink ? (
                        <img alt="" className="size-full object-cover" src={permission.photoLink} />
                      ) : (
                        getInitials(permission.displayName, permission.emailAddress)
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-black">
                        {permission.displayName ?? permission.emailAddress ?? getTypeLabel(permission.type)}
                      </div>
                      <div className="truncate text-xs font-bold text-muted-foreground">
                        {permission.emailAddress ?? getTypeLabel(permission.type)}
                      </div>
                    </div>
                    <div className="text-xs font-black text-muted-foreground">
                      {getRoleLabel(permission.role)}
                    </div>
                  </div>
                ))}
              </div>
            </section>
            <Separator />
            <section>
              <h4 className="mb-2 text-sm font-black">{dictionary.driveGeneralAccess}</h4>
              <div className="flex items-center gap-3 rounded-lg border bg-muted/25 p-3">
                <div className="grid size-9 place-items-center rounded-full bg-muted">
                  {generalAccess ? (
                    <Link aria-hidden="true" className="size-4 text-primary" />
                  ) : (
                    <Lock aria-hidden="true" className="size-4 text-muted-foreground" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-black">
                    {generalAccess?.type === 'anyone'
                      ? dictionary.driveAnyoneAccess
                      : generalAccess?.type === 'domain'
                        ? dictionary.driveDomainAccess
                        : dictionary.driveRestrictedAccess}
                  </div>
                  <div className="text-xs font-bold text-muted-foreground">
                    {generalAccess ? getRoleLabel(generalAccess.role) : dictionary.driveNoExternalOpen}
                  </div>
                </div>
              </div>
            </section>
          </div>
          <DialogFooter>
            <Button
              className="mr-auto"
              disabled={!item?.webViewLink}
              onClick={() => void copyShareLink()}
              type="button"
              variant="outline"
            >
              <Copy aria-hidden="true" className="size-4" />
              {isLinkCopied ? dictionary.driveLinkCopied : dictionary.driveCopyLink}
            </Button>
            <Button onClick={() => setIsAccessOpen(false)} type="button">
              {dictionary.driveDone}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
