import { describe, expect, it } from 'vitest'
import path from 'path'
import { getManagedPathCandidates } from '../../electron/install-paths.js'

const LAUNCHER_DIR = path.resolve('launcher-root')
const WORKSPACE_DIR = path.resolve('workspace-root')

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

  it('returns an empty array for blank paths', () => {
    expect(getManagedPathCandidates('   ', LAUNCHER_DIR, WORKSPACE_DIR)).toEqual([])
  })
})

