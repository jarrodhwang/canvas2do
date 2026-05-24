import { useMemo, useState, type ReactNode } from 'react';
import { getMockDataForMode } from '../data/mockWorkspaceData';
import { modeRegistry } from '../modes/ModeRegistry';
import { WorkspaceModeContext } from './WorkspaceModeContext';

export function WorkspaceModeProvider({ children }: { children: ReactNode }) {
  const visibleModes = useMemo(() => modeRegistry.getVisible(), []);
  const defaultMode = useMemo(() => modeRegistry.getDefault(), []);
  const [activeModeId, setActiveModeIdState] = useState(defaultMode.id);

  const activeMode = modeRegistry.getById(activeModeId) ?? defaultMode;
  const activeData = getMockDataForMode(activeMode.id);

  const setActiveModeId = (modeId: string) => {
    const requestedMode = modeRegistry.getById(modeId);

    if (requestedMode?.enabled && !requestedMode.hidden) {
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
