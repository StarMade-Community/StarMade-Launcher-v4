import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useData } from '../../contexts/DataContext';
import BackupConfirmModal from './BackupConfirmModal';

const SK_IGNORED_UPDATES = 'ignoredGameUpdates';

const GameUpdateNotice: React.FC = () => {
  const { installations, selectedInstallationId, versions, updateInstallation, downloadVersion } = useData();
  const [ignoredUpdates, setIgnoredUpdates] = useState<Record<string, string>>({});
  const [dismissed, setDismissed] = useState(false);
  const [backupPending, setBackupPending] = useState(false);

  useEffect(() => {
    window.launcher?.store?.get(SK_IGNORED_UPDATES).then((val) => {
      if (val && typeof val === 'object') setIgnoredUpdates(val as Record<string, string>);
    }).catch(() => {});
  }, []);

  const selectedInstallation = useMemo(
    () => installations.find((i) => i.id === selectedInstallationId) ?? null,
    [installations, selectedInstallationId],
  );

  const availableUpdate = useMemo(() => {
    if (!selectedInstallation || !versions.length) return null;

    const currentVersion = selectedInstallation.version;
    const branch = selectedInstallation.type;

    const branchVersions = versions.filter((v) => v.type === branch);
    if (branchVersions.length === 0) return null;

    const latest = branchVersions[0];
    if (!latest || latest.id === currentVersion) return null;

    if (ignoredUpdates[selectedInstallation.id] === latest.id) return null;

    return { from: currentVersion, to: latest.id, toName: latest.name, target: latest };
  }, [selectedInstallation, versions, ignoredUpdates]);

  useEffect(() => {
    setDismissed(false);
  }, [selectedInstallationId]);

  const applyUpdate = useCallback(() => {
    if (!selectedInstallation || !availableUpdate) return;
    // Carry the new version's buildPath forward — otherwise downloadVersion
    // reuses the stale buildPath and re-downloads the old build, leaving the
    // install on its previous version despite the label changing.
    updateInstallation({
      ...selectedInstallation,
      version: availableUpdate.to,
      buildPath: availableUpdate.target.buildPath,
      requiredJavaVersion: availableUpdate.target.requiredJavaVersion ?? selectedInstallation.requiredJavaVersion,
      installed: false,
    });
    downloadVersion(selectedInstallation.id);
    setBackupPending(false);
    setDismissed(true);
  }, [selectedInstallation, availableUpdate, updateInstallation, downloadVersion]);

  const handleUpdate = () => {
    setBackupPending(true);
  };

  const handleBackupAndContinue = useCallback(async () => {
    if (!selectedInstallation) return;

    if (typeof window === 'undefined' || !window.launcher?.installation?.backup) {
      throw new Error('Backup API is not available in this environment.');
    }

    const result = await window.launcher.installation.backup(
      selectedInstallation.path,
      selectedInstallation.id,
      selectedInstallation.name,
    );
    if (!result.success) {
      throw new Error(result.error ?? 'Backup failed');
    }
    applyUpdate();
  }, [selectedInstallation, applyUpdate]);

  const handleIgnore = async () => {
    if (!selectedInstallation) return;
    const next = { ...ignoredUpdates, [selectedInstallation.id]: availableUpdate!.to };
    setIgnoredUpdates(next);
    setDismissed(true);
    await window.launcher?.store?.set(SK_IGNORED_UPDATES, next);
  };

  if (!availableUpdate || dismissed) return null;

  return (
    <>
      <div className="fixed top-16 right-6 z-40 animate-fade-in-scale">
        <div className="flex items-center gap-3 px-4 py-2.5 rounded-lg bg-slate-900/90 backdrop-blur-sm border border-starmade-accent/30 shadow-lg shadow-black/30">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-gray-400">Update:</span>
            <span className="font-mono text-gray-500">{availableUpdate.from}</span>
            <span className="text-gray-600">&rarr;</span>
            <span className="font-mono text-starmade-accent font-semibold">{availableUpdate.to}</span>
          </div>
          <button
            onClick={handleUpdate}
            className="px-3 py-1 text-xs font-bold uppercase tracking-wider rounded bg-starmade-accent hover:bg-starmade-accent/80 transition-colors text-white"
          >
            Update
          </button>
          <button
            onClick={() => void handleIgnore()}
            className="px-2 py-1 text-xs font-medium rounded hover:bg-white/10 transition-colors text-gray-400 hover:text-white"
          >
            Ignore
          </button>
        </div>
      </div>
      <BackupConfirmModal
        isOpen={backupPending}
        installationName={selectedInstallation?.name ?? ''}
        fromVersion={availableUpdate.from}
        toVersion={availableUpdate.to}
        onBackupAndContinue={handleBackupAndContinue}
        onSkipBackup={applyUpdate}
        onCancel={() => setBackupPending(false)}
      />
    </>
  );
};

export default GameUpdateNotice;
