import { describe, expect, it } from 'vitest'
import { getManagedPathCandidates } from '../../electron/install-paths.js'

describe('getManagedPathCandidates', () => {
  it('returns the absolute path unchanged', () => {
    expect(getManagedPathCandidates('/games/StarMade/Test', '/launcher', '/workspace')).toEqual([
      '/games/StarMade/Test',
    ])
  })

  it('resolves relative paths against launcherDir first and also includes cwd fallback', () => {
    expect(getManagedPathCandidates('./StarMade/Installations/Test', '/opt/starmade-launcher', '/home/garret')).toEqual([
      '/opt/starmade-launcher/StarMade/Installations/Test',
      '/home/garret/StarMade/Installations/Test',
    ])
  })

  it('deduplicates identical launcherDir and cwd resolutions', () => {
    expect(getManagedPathCandidates('./StarMade/Servers/Test', '/home/garret', '/home/garret')).toEqual([
      '/home/garret/StarMade/Servers/Test',
    ])
  })

  it('returns an empty array for blank paths', () => {
    expect(getManagedPathCandidates('   ', '/launcher', '/workspace')).toEqual([])
  })
})

