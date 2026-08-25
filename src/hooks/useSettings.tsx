import { createContext, useContext, useState, useCallback, useEffect, type FC, type ReactNode } from 'react';

export type FontMode = 'retro' | 'modern';
export type ThemeMode = 'dark' | 'light';

interface Settings {
  fontMode: FontMode;
  theme: ThemeMode;
}

interface SettingsContextValue extends Settings {
  setFontMode: (mode: FontMode) => void;
  setTheme: (theme: ThemeMode) => void;
}

const STORAGE_KEY = 'fbb-scores-settings';

const defaults: Settings = { fontMode: 'modern', theme: 'dark' };

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

const SettingsContext = createContext<SettingsContextValue>({
  ...defaults,
  setFontMode: () => {},
  setTheme: () => {},
});

export const SettingsProvider: FC<{ children: ReactNode }> = ({ children }) => {
  const [settings, setSettings] = useState<Settings>(loadSettings);

  const setFontMode = useCallback((mode: FontMode) => {
    setSettings((prev) => {
      const next = { ...prev, fontMode: mode };
      saveSettings(next);
      return next;
    });
  }, []);

  const setTheme = useCallback((theme: ThemeMode) => {
    setSettings((prev) => {
      const next = { ...prev, theme };
      saveSettings(next);
      return next;
    });
  }, []);

  // Keep the document classes in sync (covers initial load + changes)
  useEffect(() => {
    document.documentElement.classList.toggle('font-modern', settings.fontMode === 'modern');
    document.documentElement.classList.toggle('theme-light', settings.theme === 'light');
  }, [settings.fontMode, settings.theme]);

  return (
    <SettingsContext.Provider value={{ ...settings, setFontMode, setTheme }}>
      {children}
    </SettingsContext.Provider>
  );
};

export function useSettings() {
  return useContext(SettingsContext);
}
