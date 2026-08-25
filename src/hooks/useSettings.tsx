import { createContext, useContext, useState, useCallback, useEffect, type FC, type ReactNode } from 'react';

export type FontMode = 'retro' | 'modern';

interface Settings {
  fontMode: FontMode;
}

interface SettingsContextValue extends Settings {
  setFontMode: (mode: FontMode) => void;
}

const STORAGE_KEY = 'fbb-scores-settings';

function loadSettings(): Settings {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return { ...defaults, ...JSON.parse(stored) };
  } catch { /* ignore */ }
  return defaults;
}

function saveSettings(settings: Settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch { /* ignore */ }
}

const defaults: Settings = { fontMode: 'modern' };

const SettingsContext = createContext<SettingsContextValue>({
  ...defaults,
  setFontMode: () => {},
});

export const SettingsProvider: FC<{ children: ReactNode }> = ({ children }) => {
  const [settings, setSettings] = useState<Settings>(loadSettings);

  const setFontMode = useCallback((mode: FontMode) => {
    setSettings(prev => {
      const next = { ...prev, fontMode: mode };
      saveSettings(next);
      // Apply CSS class to document for global font switching
      document.documentElement.classList.toggle('font-modern', mode === 'modern');
      return next;
    });
  }, []);

  // Keep the document class in sync (covers initial load + external changes)
  useEffect(() => {
    document.documentElement.classList.toggle('font-modern', settings.fontMode === 'modern');
  }, [settings.fontMode]);

  return (
    <SettingsContext.Provider value={{ ...settings, setFontMode }}>
      {children}
    </SettingsContext.Provider>
  );
};

export function useSettings() {
  return useContext(SettingsContext);
}
