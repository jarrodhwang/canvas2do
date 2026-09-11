import { useSyncExternalStore } from 'react';
import { academyTermStore } from './academyTermStore';
export function useAcademyTerms() {
  return useSyncExternalStore(academyTermStore.subscribe, academyTermStore.getSnapshot);
}
