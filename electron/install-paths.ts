import path from 'path'

/**
 * Resolve a launcher-managed installation path to a single, deterministic
 * absolute path.
 *
 * Absolute paths are returned normalised and unchanged.  Relative paths (for
 * example `./StarMade/Installations/My Install`) are resolved against
 * `managedRoot` — a stable, user-writable directory chosen by the main process.
 *
 * This must never resolve against `process.cwd()`: on the Windows portable
 * build the working directory is the self-extracting temp directory, which is
 * deleted on reboot/teardown.  Persisting a path that depends on `cwd` causes
 * downloaded game files to land in that throwaway directory and silently
 * disappear (see the launcher-path Windows bug report).
 *
 * Returns an empty string for blank input so callers can detect "no path set".
 */
export function resolveManagedInstallPath(
  targetPath: string,
  managedRoot: string,
): string {
  const trimmedPath = (targetPath ?? '').trim()
  if (trimmedPath === '') return ''
  if (path.isAbsolute(trimmedPath)) return path.normalize(trimmedPath)
  return path.resolve(managedRoot, trimmedPath)
}

/**
 * Build the candidate absolute paths for a launcher-managed installation path.
 *
 * Historical launcher records may contain relative paths (for example
 * `./StarMade/Installations/My Install`). Those are resolved against, in order:
 * the managed install root (the canonical location new installs are written to),
 * the launcher's data directory, and finally the process working directory for
 * the oldest dev records.  The caller picks the first candidate that exists.
 *
 * Pass `managedRoot` (see resolveManagedInstallPath) so reads prefer the same
 * absolute location that downloads are written to.
 */
export function getManagedPathCandidates(
  targetPath: string,
  launcherDir: string,
  cwd = process.cwd(),
  managedRoot?: string,
): string[] {
  const trimmedPath = targetPath.trim()
  if (trimmedPath === '') return []

  const candidates = new Set<string>()
  const addCandidate = (candidatePath: string) => {
    if (!candidatePath) return
    candidates.add(path.normalize(candidatePath))
  }

  if (path.isAbsolute(trimmedPath)) {
    addCandidate(trimmedPath)
  } else {
    if (managedRoot) addCandidate(path.resolve(managedRoot, trimmedPath))
    addCandidate(path.resolve(launcherDir, trimmedPath))
    addCandidate(path.resolve(cwd, trimmedPath))
  }

  return [...candidates]
}

