import { defaultModeConfigs } from './defaultModes';
import type { ModeVisibilityOverride, WorkspaceModeConfig } from './types';

export class ModeRegistry {
  private readonly modes: WorkspaceModeConfig[];

  constructor(
    modes: WorkspaceModeConfig[],
    overrides: Record<string, ModeVisibilityOverride> = {},
  ) {
    this.modes = modes.map((mode) => ({
      ...mode,
      ...overrides[mode.id],
    }));
  }

  getAll(): WorkspaceModeConfig[] {
    return this.modes;
  }

  getVisible(): WorkspaceModeConfig[] {
    return this.modes.filter((mode) => mode.enabled && !mode.hidden);
  }

  getById(modeId: string): WorkspaceModeConfig | undefined {
    return this.modes.find((mode) => mode.id === modeId);
  }

  getDefault(): WorkspaceModeConfig {
    const visibleModes = this.getVisible();

    return visibleModes.find((mode) => mode.id === 'project') ??
      visibleModes[0] ??
      this.modes.find((mode) => mode.enabled) ??
      this.modes[0];
  }
}

const parseCsv = (value: string | undefined) =>
  value
    ?.split(',')
    .map((entry) => entry.trim())
    .filter(Boolean) ?? [];

const getModeOverridesFromEnv = (): Record<string, ModeVisibilityOverride> => {
  const enabledModes = parseCsv(import.meta.env.VITE_ENABLED_WORKSPACE_MODES);
  const hiddenModes = parseCsv(import.meta.env.VITE_HIDDEN_WORKSPACE_MODES);
  const renamedAcademy = import.meta.env.VITE_MODE_NAME_ACADEMY;
  const renamedProject = import.meta.env.VITE_MODE_NAME_PROJECT;

  const overrides: Record<string, ModeVisibilityOverride> = {};

  if (enabledModes.length > 0) {
    defaultModeConfigs.forEach((mode) => {
      overrides[mode.id] = {
        ...overrides[mode.id],
        enabled: enabledModes.includes(mode.id),
        hidden: !enabledModes.includes(mode.id),
      };
    });
  }

  hiddenModes.forEach((modeId) => {
    overrides[modeId] = {
      ...overrides[modeId],
      hidden: true,
    };
  });

  if (renamedAcademy) {
    overrides.academy = {
      ...overrides.academy,
      displayName: renamedAcademy,
    };
  }

  if (renamedProject) {
    overrides.project = {
      ...overrides.project,
      displayName: renamedProject,
    };
  }

  return overrides;
};

export const modeRegistry = new ModeRegistry(defaultModeConfigs, getModeOverridesFromEnv());
