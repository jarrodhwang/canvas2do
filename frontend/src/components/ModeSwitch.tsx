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
      className="max-w-full max-[520px]:w-full max-[520px]:overflow-x-auto max-[520px]:pb-1"
      onValueChange={onModeChange}
      value={activeModeId}
    >
      <TabsList className="h-10 rounded-lg border bg-muted p-1 max-[520px]:inline-flex max-[520px]:h-8 max-[520px]:min-w-max max-[520px]:rounded-md max-[520px]:p-0.5">
      {modes.map((mode) => (
        <TabsTrigger
          className="h-8 rounded-md px-3 text-xs font-bold text-muted-foreground data-active:bg-primary data-active:text-primary-foreground data-[state=active]:bg-primary data-[state=active]:text-primary-foreground max-[520px]:h-7 max-[520px]:px-2 max-[520px]:text-[10px]"
          key={mode.id}
          value={mode.id}
        >
          <WorkspaceIcon name={mode.icon} size={16} className="max-[520px]:size-3.5" />
          <span className="max-[520px]:max-w-[86px] max-[520px]:truncate">
            {translateModeName(mode.id, mode.displayName)}
          </span>
        </TabsTrigger>
      ))}
      </TabsList>
    </Tabs>
  );
}
