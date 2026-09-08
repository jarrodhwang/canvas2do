import type { ReactNode } from 'react';
import { academyWorkspaceData } from '../data/mockWorkspaceData';
import { defaultModeConfigs } from '../modes/defaultModes';
import { WorkspaceModeContext } from './WorkspaceModeContext';

const academyMode = defaultModeConfigs[0];

if (!academyMode) {
  throw new Error('Canvas To Do requires its academy mode configuration.');
}

const academyModeContext = {
  activeData: academyWorkspaceData,
  activeMode: academyMode,
};

export function WorkspaceModeProvider({ children }: { children: ReactNode }) {
  return <WorkspaceModeContext.Provider value={academyModeContext}>{children}</WorkspaceModeContext.Provider>;
}
