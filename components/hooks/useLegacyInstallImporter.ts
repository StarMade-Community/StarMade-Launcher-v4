import { useCallback, useMemo, useRef, useState } from 'react';
import { useData } from '@/contexts/DataContext';
import { buildLegacyImportedInstallation, dedupeLegacyInstallPaths } from '@/utils/legacyImport';

const useLegacyInstallImporter = () => {
  const { installations, addInstallation, versions } = useData();
  const [importedPaths, setImportedPaths] = useState<Set<string>>(new Set());
  const importedPathsRef = useRef<Set<string>>(new Set());
  const importingPathsRef = useRef<Set<string>>(new Set());

  const existingPaths = useMemo(
    () => new Set(installations.map(installation => installation.path.trim())),
    [installations],
  );

  const isKnownPath = useCallback(
    (installPath: string): boolean => {
      const normalizedPath = installPath.trim();
      return existingPaths.has(normalizedPath) || importedPaths.has(normalizedPath);
    },
    [existingPaths, importedPaths],
  );

  const importInstallation = useCallback(
    async (installPath: string): Promise<boolean> => {
      const normalizedPath = installPath.trim();
      if (
        !normalizedPath
        || existingPaths.has(normalizedPath)
        || importedPathsRef.current.has(normalizedPath)
        || importingPathsRef.current.has(normalizedPath)
      ) {
        return false;
      }

      importingPathsRef.current = new Set([...importingPathsRef.current, normalizedPath]);

      try {
        const newItem = await buildLegacyImportedInstallation(normalizedPath, versions);
        importedPathsRef.current = new Set([...importedPathsRef.current, normalizedPath]);
        setImportedPaths(new Set(importedPathsRef.current));
        addInstallation(newItem);
        return true;
      } finally {
        const nextImportingPaths = new Set(importingPathsRef.current);
        nextImportingPaths.delete(normalizedPath);
        importingPathsRef.current = nextImportingPaths;
      }
    },
    [addInstallation, existingPaths, versions],
  );

  const importInstallations = useCallback(
    async (paths: string[]): Promise<{ imported: string[]; skipped: string[] }> => {
      const imported: string[] = [];
      const skipped: string[] = [];

      for (const installPath of dedupeLegacyInstallPaths(paths)) {
        if (await importInstallation(installPath)) {
          imported.push(installPath);
        } else {
          skipped.push(installPath);
        }
      }

      return { imported, skipped };
    },
    [importInstallation],
  );

  return {
    existingPaths,
    importedPaths,
    isKnownPath,
    importInstallation,
    importInstallations,
  };
};

export default useLegacyInstallImporter;


