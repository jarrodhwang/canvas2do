import { useMemo, useState, type ReactNode } from 'react';
import {
  getDictionary,
  getInitialLanguage,
  type Language,
  translateDashboardCard as translateDashboardCardValue,
  translateRecordValue,
} from '../i18n';
import { LanguageContext, type LanguageContextValue } from './LanguageContext';

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(getInitialLanguage);

  const setLanguage = (nextLanguage: Language) => {
    setLanguageState(nextLanguage);
    window.localStorage.setItem('incos-workspace-language', nextLanguage);
    document.documentElement.lang = nextLanguage;
  };

  const value = useMemo<LanguageContextValue>(() => {
    const dictionary = getDictionary(language);

    return {
      language,
      setLanguage,
      dictionary,
      translateModeName: (modeId, fallback) =>
        translateRecordValue(language, 'modeNames', modeId, fallback),
      translateModePurpose: (modeId, fallback) =>
        translateRecordValue(language, 'modePurposes', modeId, fallback),
      translateSectionLabel: (sectionId, fallback) =>
        translateRecordValue(language, 'sectionLabels', sectionId, fallback),
      translateItemLabel: (itemId, fallback) =>
        translateRecordValue(language, 'itemLabels', itemId, fallback),
      translateFieldLabel: (fieldId, fallback) =>
        translateRecordValue(language, 'fieldLabels', fieldId, fallback),
      translateBoardColumn: (columnId, fallback) =>
        translateRecordValue(language, 'boardColumns', columnId, fallback),
      translateDashboardCard: (modeId, card) =>
        translateDashboardCardValue(language, modeId, card),
    };
  }, [language]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}
