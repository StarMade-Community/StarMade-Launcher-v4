 import { useState, useEffect } from 'react';

/**
 * Remote fallback backgrounds used when no local images are available.
 * Users can add their own images to:
 *   Packaged app : ~/.config/StarMade Launcher/backgrounds/   (Linux)
 *                  %APPDATA%\StarMade Launcher\backgrounds\   (Windows)
 *   Dev (Electron): ~/.config/Electron/backgrounds/
 *   Bundled       : <app>/backgrounds/   (adjacent to dist-electron/)
 */
const FALLBACK_BACKGROUNDS: string[] = [
  'https://www.star-made.org/images/bg1.jpg',
];

/** Fisher-Yates in-place shuffle — returns a new shuffled copy. */
function shuffled<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Module-level cache — shuffled once per session so all callers share the same order.
let _cache: string[] | null = null;

/**
 * Returns the full shuffled background list, fetching from IPC on first call.
 * Index 0 is reserved for the app background (useRandomBackground).
 * News / other callers should slice from index 1 to avoid repeating that image.
 */
export async function getBackgroundList(): Promise<string[]> {
  if (_cache !== null) return _cache;

  let list: string[] = [];

  if (typeof window !== 'undefined' && window.launcher?.backgrounds) {
    try {
      list = await window.launcher.backgrounds.list();
    } catch {
      // IPC failed — fall through to remote fallback
    }
  }

  if (list.length === 0) list = FALLBACK_BACKGROUNDS;

  _cache = shuffled(list);
  return _cache;
}

/** Pick a uniformly random element from an array. */
export function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Returns the app-level background (always index 0 of the shuffled list)
 * plus a `loaded` flag that turns true once the image has finished loading.
 */
const useRandomBackground = (): { url: string; loaded: boolean } => {
  const [url, setUrl]       = useState('');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      let chosen = '';

      if (typeof window !== 'undefined' && window.launcher?.backgrounds?.getPreferred) {
        try {
          const preferred = await window.launcher.backgrounds.getPreferred();
          if (typeof preferred === 'string' && preferred.trim().length > 0) {
            chosen = preferred;
          }
        } catch {
          // Ignore and fall back to random list.
        }
      }

      if (!chosen) {
        const list = await getBackgroundList();
        chosen = list[0]; // always index 0 — news cards use slice(1)
      }

      if (cancelled || !chosen) return;

      setLoaded(false);
      setUrl(chosen);

      const img = new window.Image();
      img.onload  = () => { if (!cancelled) setLoaded(true); };
      img.onerror = () => { if (!cancelled) setLoaded(true); };
      img.src = chosen;
    };

    void load();

    const reloadOnChange = () => {
      void load();
    };
    window.addEventListener('launcher-background-changed', reloadOnChange);

    return () => {
      cancelled = true;
      window.removeEventListener('launcher-background-changed', reloadOnChange);
    };
  }, []);

  return { url, loaded };
};

export default useRandomBackground;

