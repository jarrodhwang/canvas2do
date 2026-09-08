import { createContext, useContext } from 'react';
import type { WorkspaceModeMockData } from '../data/mockWorkspaceData';
import type { WorkspaceModeConfig } from '../modes/types';

export interface WorkspaceModeContextValue {
  activeMode: WorkspaceModeConfig;
  activeData: WorkspaceModeMockData;
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
