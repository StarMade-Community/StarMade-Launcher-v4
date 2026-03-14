import path from 'path'

/**
 * Build the candidate absolute paths for a launcher-managed installation path.
 *
 * Historical launcher records may contain relative paths (for example
 * `./StarMade/Installations/My Install`). Those need to be resolved against the
 * launcher's data directory in packaged builds, while older/dev records may
 * still resolve relative to the process working directory.
 */
export function getManagedPathCandidates(
  targetPath: string,
  launcherDir: string,
  cwd = process.cwd(),
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
    addCandidate(path.resolve(launcherDir, trimmedPath))
    addCandidate(path.resolve(cwd, trimmedPath))
  }

  return [...candidates]
}

