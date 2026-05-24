import { useLanguage } from '../context/LanguageContext';
import { WorkspaceIcon } from './WorkspaceIcon';
import { Tabs, TabsList, TabsTrigger } from './ui/tabs';
import type { WorkspaceModeConfig } from '../modes/types';

interface ModeSwitchProps {
  modes: WorkspaceModeConfig[];
  activeModeId: string;
  onModeChange: (modeId: string) => void;
}

export function ModeSwitch({ modes, activeModeId, onModeChange }: ModeSwitchProps) {
  const { translateModeName } = useLanguage();

  return (
    <Tabs
      aria-label="Workspace mode switch"
      className="max-w-full"
      onValueChange={onModeChange}
      value={activeModeId}
    >
      <TabsList className="h-10 rounded-lg border bg-muted p-1">
      {modes.map((mode) => (
        <TabsTrigger
          className="h-8 rounded-md px-3 text-xs font-bold text-muted-foreground data-active:bg-primary data-active:text-primary-foreground data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
          key={mode.id}
          value={mode.id}
        >
          <WorkspaceIcon name={mode.icon} size={16} />
          <span>{translateModeName(mode.id, mode.displayName)}</span>
        </TabsTrigger>
      ))}
      </TabsList>
    </Tabs>
  );
}
