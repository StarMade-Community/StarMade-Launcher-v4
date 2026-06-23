import { describe, expect, it } from 'vitest'
import path from 'path'
import { getManagedPathCandidates, resolveManagedInstallPath } from '../../electron/install-paths.js'

const LAUNCHER_DIR = path.resolve('launcher-root')
const WORKSPACE_DIR = path.resolve('workspace-root')
const MANAGED_ROOT = path.resolve('managed-root')

describe('getManagedPathCandidates', () => {
  it('returns the absolute path unchanged', () => {
    const absoluteTarget = path.resolve('games', 'StarMade', 'Test')
    expect(getManagedPathCandidates(absoluteTarget, LAUNCHER_DIR, WORKSPACE_DIR)).toEqual([
      path.normalize(absoluteTarget),
    ])
  })

  it('resolves relative paths against launcherDir first and also includes cwd fallback', () => {
    const relativeTarget = path.join('StarMade', 'Installations', 'Test')
    expect(getManagedPathCandidates(relativeTarget, LAUNCHER_DIR, WORKSPACE_DIR)).toEqual([
      path.resolve(LAUNCHER_DIR, relativeTarget),
      path.resolve(WORKSPACE_DIR, relativeTarget),
    ])
  })

  it('deduplicates identical launcherDir and cwd resolutions', () => {
    const sharedBase = path.resolve('shared-root')
    const relativeTarget = path.join('StarMade', 'Servers', 'Test')
    expect(getManagedPathCandidates(relativeTarget, sharedBase, sharedBase)).toEqual([
      path.resolve(sharedBase, relativeTarget),
    ])
  })

  it('prefers the managed root for relative paths when provided', () => {
    const relativeTarget = path.join('StarMade', 'Installations', 'Test')
    expect(getManagedPathCandidates(relativeTarget, LAUNCHER_DIR, WORKSPACE_DIR, MANAGED_ROOT)).toEqual([
      path.resolve(MANAGED_ROOT, relativeTarget),
      path.resolve(LAUNCHER_DIR, relativeTarget),
      path.resolve(WORKSPACE_DIR, relativeTarget),
    ])
  })

  it('ignores the managed root for absolute paths', () => {
    const absoluteTarget = path.resolve('games', 'StarMade', 'Test')
    expect(getManagedPathCandidates(absoluteTarget, LAUNCHER_DIR, WORKSPACE_DIR, MANAGED_ROOT)).toEqual([
      path.normalize(absoluteTarget),
    ])
  })

  it('returns an empty array for blank paths', () => {
    expect(getManagedPathCandidates('   ', LAUNCHER_DIR, WORKSPACE_DIR)).toEqual([])
  })
})

describe('resolveManagedInstallPath', () => {
  it('resolves a relative path against the managed root', () => {
    const relativeTarget = path.join('.', 'StarMade', 'Installations', 'My Install')
    expect(resolveManagedInstallPath(relativeTarget, MANAGED_ROOT)).toBe(
      path.resolve(MANAGED_ROOT, relativeTarget),
    )
  })

  it('returns an absolute path normalised and unchanged', () => {
    const absoluteTarget = path.resolve('games', 'StarMade', 'Test')
    expect(resolveManagedInstallPath(absoluteTarget, MANAGED_ROOT)).toBe(path.normalize(absoluteTarget))
  })

  it('never resolves against the working directory', () => {
    const resolved = resolveManagedInstallPath('StarMade/Installations/X', MANAGED_ROOT)
    expect(resolved.startsWith(MANAGED_ROOT)).toBe(true)
    expect(resolved).not.toContain(path.resolve('StarMade/Installations/X'))
  })

  it('returns an empty string for blank input', () => {
    expect(resolveManagedInstallPath('   ', MANAGED_ROOT)).toBe('')
    expect(resolveManagedInstallPath('', MANAGED_ROOT)).toBe('')
  })
})

