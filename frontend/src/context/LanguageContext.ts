import { createContext, useContext } from 'react';
import type { getDictionary, Language } from '../i18n';
import type { DashboardCardConfig } from '../modes/types';

export interface LanguageContextValue {
  language: Language;
  setLanguage: (language: Language) => void;
  dictionary: ReturnType<typeof getDictionary>;
  translateModeName: (modeId: string, fallback: string) => string;
  translateModePurpose: (modeId: string, fallback: string) => string;
  translateSectionLabel: (sectionId: string, fallback: string) => string;
  translateItemLabel: (itemId: string, fallback: string) => string;
  translateFieldLabel: (fieldId: string, fallback: string) => string;
  translateBoardColumn: (columnId: string, fallback: string) => string;
  translateDashboardCard: (modeId: string, card: DashboardCardConfig) => DashboardCardConfig;
}

export const LanguageContext = createContext<LanguageContextValue | undefined>(undefined);

export function useLanguage() {
  const context = useContext(LanguageContext);

  if (!context) {
    throw new Error('useLanguage must be used within LanguageProvider');
  }

  return context;
}
