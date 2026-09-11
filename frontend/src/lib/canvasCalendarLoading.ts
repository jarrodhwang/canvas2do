import type { CanvasTokenStatus } from '../api/canvasToDoApi';

export type CanvasCalendarLoadStatus = 'idle' | 'loading' | 'loaded' | 'failed';

export function getCanvasCalendarLoadState(
  enabled: boolean,
  tokenStatus: Pick<CanvasTokenStatus, 'status'> | null,
  pageStatus?: CanvasCalendarLoadStatus,
): { shouldLoad: boolean; status: CanvasCalendarLoadStatus } {
  // Reminder preferences do not determine whether a Canvas connection exists.
  // Unknown status and existing credentials retain normal request/error handling.
  const shouldLoad = enabled &&
    tokenStatus?.status !== 'needs_connection' &&
    tokenStatus?.status !== 'manual_mode';

  return {
    shouldLoad,
    // A cancelled request can leave its cached page marked as loading.
    status: shouldLoad ? pageStatus ?? 'loading' : 'idle',
  };
}
