import { useCallback, useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';

// The <html> class is the source of truth (set pre-paint by the inline script in
// index.html). This hook just reads/flips it and persists the choice.
function currentTheme(): Theme {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(currentTheme);

  const setTheme = useCallback((t: Theme) => {
    document.documentElement.classList.toggle('dark', t === 'dark');
    try { localStorage.setItem('dryrun_theme', t); } catch { /* ignore */ }
    setThemeState(t);
  }, []);

  const toggle = useCallback(() => {
    setTheme(currentTheme() === 'dark' ? 'light' : 'dark');
  }, [setTheme]);

  // Sync in case the class changed elsewhere (e.g. another tab / the inline script).
  useEffect(() => { setThemeState(currentTheme()); }, []);

  return { theme, toggle, setTheme };
}
