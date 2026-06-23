import { useMemo, useState, type ReactNode } from 'react';
import { getMockDataForMode } from '../data/mockWorkspaceData';
import { modeRegistry } from '../modes/ModeRegistry';
import { WorkspaceModeContext } from './WorkspaceModeContext';

const activeModeStorageKey = 'incos-workspace-active-mode';

function getInitialActiveModeId(defaultModeId: string) {
  if (typeof window === 'undefined') {
    return defaultModeId;
  }

  const storedModeId = window.localStorage.getItem(activeModeStorageKey);
  const storedMode = storedModeId ? modeRegistry.getById(storedModeId) : undefined;

  return storedMode?.enabled && !storedMode.hidden ? storedMode.id : defaultModeId;
}

export function WorkspaceModeProvider({ children }: { children: ReactNode }) {
  const visibleModes = useMemo(() => modeRegistry.getVisible(), []);
  const defaultMode = useMemo(() => modeRegistry.getDefault(), []);
  const [activeModeId, setActiveModeIdState] = useState(() => getInitialActiveModeId(defaultMode.id));

  const activeMode = modeRegistry.getById(activeModeId) ?? defaultMode;
  const activeData = getMockDataForMode(activeMode.id);

  const setActiveModeId = (modeId: string) => {
    const requestedMode = modeRegistry.getById(modeId);

    if (requestedMode?.enabled && !requestedMode.hidden) {
      window.localStorage.setItem(activeModeStorageKey, modeId);
      setActiveModeIdState(modeId);
    }
  };

  const value = useMemo(
    () => ({
      registry: modeRegistry,
      visibleModes,
      activeMode,
      activeModeId: activeMode.id,
      activeData,
      setActiveModeId,
    }),
    [activeData, activeMode, visibleModes],
  );

  return <WorkspaceModeContext.Provider value={value}>{children}</WorkspaceModeContext.Provider>;
}
