import { createContext, useContext } from 'react';

export type SettingsTab = 'general' | 'integrations';
export type OpenSettings = (tab: SettingsTab, invoker: HTMLElement | null, afterCatalogSaved?: () => void) => void;

export const SettingsContext = createContext<OpenSettings>(() => {});

export function useSettings() {
  return useContext(SettingsContext);
}
