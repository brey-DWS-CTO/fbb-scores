import { createContext, useContext, useState, useCallback, useEffect, type FC, type ReactNode } from 'react';

export type ThemeMode = 'dark' | 'light';

interface Settings {
  theme: ThemeMode;
}

interface SettingsContextValue extends Settings {
  setTheme: (theme: ThemeMode) => void;
}

const STORAGE_KEY = 'fbb-scores-settings';

const defaults: Settings = { theme: 'dark' };

function loadSettings(): Settings {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as Partial<Settings>;
      return { theme: parsed.theme === 'light' ? 'light' : 'dark' };
    }
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
  setTheme: () => {},
});

export const SettingsProvider: FC<{ children: ReactNode }> = ({ children }) => {
  const [settings, setSettings] = useState<Settings>(loadSettings);

  const setTheme = useCallback((theme: ThemeMode) => {
    setSettings((prev) => {
      const next = { ...prev, theme };
      saveSettings(next);
      return next;
    });
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('theme-light', settings.theme === 'light');
  }, [settings.theme]);

  return (
    <SettingsContext.Provider value={{ ...settings, setTheme }}>
      {children}
    </SettingsContext.Provider>
  );
};

export function useSettings() {
  return useContext(SettingsContext);
}
