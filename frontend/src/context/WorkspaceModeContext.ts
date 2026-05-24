import { createContext, useContext } from 'react';
import type { WorkspaceModeMockData } from '../data/mockWorkspaceData';
import type { ModeRegistry } from '../modes/ModeRegistry';
import type { WorkspaceModeConfig } from '../modes/types';

export interface WorkspaceModeContextValue {
  registry: ModeRegistry;
  visibleModes: WorkspaceModeConfig[];
  activeMode: WorkspaceModeConfig;
  activeModeId: string;
  activeData: WorkspaceModeMockData;
  setActiveModeId: (modeId: string) => void;
}

export const WorkspaceModeContext = createContext<WorkspaceModeContextValue | undefined>(
  undefined,
);

export function useWorkspaceMode() {
  const context = useContext(WorkspaceModeContext);

  if (!context) {
    throw new Error('useWorkspaceMode must be used within WorkspaceModeProvider');
  }

  return context;
}
