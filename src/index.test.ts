import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { ActionConfig, PullRequest } from './types'

// Stable mock references created once and shared with the (hoisted) vi.mock
// factories below, so they survive the vi.resetModules() in loadIndex().
const mocks = vi.hoisted(() => ({
  context: {
    eventName: '',
    // biome-ignore lint/suspicious/noExplicitAny: payload shape varies per event
    payload: {} as Record<string, any>,
    repo: { owner: 'mockUser', repo: 'mockRepo' },
  },
  core: {
    warning: vi.fn(),
    setFailed: vi.fn(),
    info: vi.fn(),
    setOutput: vi.fn(),
  },
  getConfig: vi.fn(),
  extractPRNumber: vi.fn(),
  fetchPR: vi.fn(),
  getReleaseNotes: vi.fn(),
  getReleaseType: vi.fn(),
  searchPRByCommit: vi.fn(),
  createRelease: vi.fn(),
  getCurrentVersion: vi.fn(),
}))

vi.mock('@actions/core', () => mocks.core)
vi.mock('@actions/github', () => ({ context: mocks.context }))
vi.mock('./config', () => ({ getConfig: mocks.getConfig }))
vi.mock('./pr', () => ({
  extractPRNumber: mocks.extractPRNumber,
  fetchPR: mocks.fetchPR,
  getReleaseNotes: mocks.getReleaseNotes,
  getReleaseType: mocks.getReleaseType,
  searchPRByCommit: mocks.searchPRByCommit,
}))
vi.mock('./version', () => ({
  createRelease: mocks.createRelease,
  getCurrentVersion: mocks.getCurrentVersion,
}))

function asConfig(config: Partial<ActionConfig>) {
  return config as ActionConfig
}

const mockPR: PullRequest = { number: 42, labels: [], body: 'pr body' }

// Re-imports index.ts so its top-level run() executes against the current
// mocks, then waits a macrotask for run()'s (already-resolved) async chain to
// settle before assertions.
async function loadIndex() {
  vi.resetModules()
  await import('./index.js')
  await new Promise((resolve) => setImmediate(resolve))
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.context.eventName = ''
  mocks.context.payload = {}
})

describe('validate mode', () => {
  test('emits version outputs for an active PR', async () => {
    mocks.getConfig.mockReturnValue(asConfig({ mode: 'validate', v: '' }))
    mocks.context.eventName = 'pull_request'
    mocks.context.payload = { pull_request: { number: 42 } }
    mocks.fetchPR.mockResolvedValue(mockPR)
    mocks.getReleaseType.mockReturnValue('minor')
    mocks.getReleaseNotes.mockReturnValue('release notes')
    mocks.getCurrentVersion.mockResolvedValue('1.2.3')

    await loadIndex()

    expect(mocks.fetchPR).toHaveBeenCalledWith(42, expect.anything())
    expect(mocks.core.setOutput).toHaveBeenCalledWith('old-version', '1.2.3')
    expect(mocks.core.setOutput).toHaveBeenCalledWith('version', '1.3.0')
    expect(mocks.core.setOutput).toHaveBeenCalledWith('release-notes', 'release notes')
    expect(mocks.core.setFailed).not.toHaveBeenCalled()
  })

  test('prefixes versions with v when configured', async () => {
    mocks.getConfig.mockReturnValue(asConfig({ mode: 'validate', v: 'v' }))
    mocks.context.eventName = 'pull_request'
    mocks.context.payload = { pull_request: { number: 42 } }
    mocks.fetchPR.mockResolvedValue(mockPR)
    mocks.getReleaseType.mockReturnValue('major')
    mocks.getReleaseNotes.mockReturnValue('notes')
    mocks.getCurrentVersion.mockResolvedValue('1.2.3')

    await loadIndex()

    expect(mocks.core.setOutput).toHaveBeenCalledWith('old-version', 'v1.2.3')
    expect(mocks.core.setOutput).toHaveBeenCalledWith('version', 'v2.0.0')
  })

  test('warns when the event is not an active PR', async () => {
    mocks.getConfig.mockReturnValue(asConfig({ mode: 'validate', v: '' }))
    mocks.context.eventName = 'push'
    mocks.context.payload = {}

    await loadIndex()

    expect(mocks.core.warning).toHaveBeenCalledWith(expect.stringContaining("'validate' mode"))
    expect(mocks.fetchPR).not.toHaveBeenCalled()
  })

  test('fails when fetching the PR throws an Error', async () => {
    mocks.getConfig.mockReturnValue(asConfig({ mode: 'validate', v: '' }))
    mocks.context.eventName = 'pull_request'
    mocks.context.payload = { pull_request: { number: 42 } }
    mocks.fetchPR.mockRejectedValue(new Error('fetch failed'))

    await loadIndex()

    expect(mocks.core.setFailed).toHaveBeenCalledWith('fetch failed')
  })

  test('fails with the stringified value when a non-Error is thrown fetching the PR', async () => {
    mocks.getConfig.mockReturnValue(asConfig({ mode: 'validate', v: '' }))
    mocks.context.eventName = 'pull_request'
    mocks.context.payload = { pull_request: { number: 42 } }
    mocks.fetchPR.mockRejectedValue('plain failure')

    await loadIndex()

    expect(mocks.core.setFailed).toHaveBeenCalledWith('plain failure')
  })

  test('fails when release metadata is invalid', async () => {
    mocks.getConfig.mockReturnValue(asConfig({ mode: 'validate', v: '' }))
    mocks.context.eventName = 'pull_request'
    mocks.context.payload = { pull_request: { number: 42 } }
    mocks.fetchPR.mockResolvedValue(mockPR)
    mocks.getReleaseType.mockImplementation(() => {
      throw new Error('no release label specified on PR')
    })

    await loadIndex()

    expect(mocks.core.setFailed).toHaveBeenCalledWith(
      'PR validation failed: no release label specified on PR',
    )
  })

  test('fails with the stringified value when release metadata throws a non-Error', async () => {
    mocks.getConfig.mockReturnValue(asConfig({ mode: 'validate', v: '' }))
    mocks.context.eventName = 'pull_request'
    mocks.context.payload = { pull_request: { number: 42 } }
    mocks.fetchPR.mockResolvedValue(mockPR)
    mocks.getReleaseType.mockReturnValue('minor')
    mocks.getReleaseNotes.mockImplementation(() => {
      throw 'bad notes'
    })

    await loadIndex()

    expect(mocks.core.setFailed).toHaveBeenCalledWith('PR validation failed: bad notes')
  })

  test('reports a skip and emits no version when the release type is skip', async () => {
    mocks.getConfig.mockReturnValue(asConfig({ mode: 'validate', v: '' }))
    mocks.context.eventName = 'pull_request'
    mocks.context.payload = { pull_request: { number: 42 } }
    mocks.fetchPR.mockResolvedValue(mockPR)
    mocks.getReleaseType.mockReturnValue('skip')
    mocks.getCurrentVersion.mockResolvedValue('1.2.3')

    await loadIndex()

    expect(mocks.core.setOutput).toHaveBeenCalledWith('old-version', '1.2.3')
    expect(mocks.core.setOutput).toHaveBeenCalledWith('skipped', true)
    expect(mocks.core.setOutput).not.toHaveBeenCalledWith('version', expect.anything())
    expect(mocks.getReleaseNotes).not.toHaveBeenCalled()
    expect(mocks.core.setFailed).not.toHaveBeenCalled()
  })
})

describe('bump mode', () => {
  test('warns when the event is not a merge commit', async () => {
    mocks.getConfig.mockReturnValue(asConfig({ mode: 'bump', v: '' }))
    mocks.context.eventName = 'pull_request'
    mocks.context.payload = {}

    await loadIndex()

    expect(mocks.core.warning).toHaveBeenCalledWith(expect.stringContaining("'bump' mode"))
    expect(mocks.createRelease).not.toHaveBeenCalled()
  })

  test('creates a release for a PR found in the commit message', async () => {
    mocks.getConfig.mockReturnValue(asConfig({ mode: 'bump', v: '' }))
    mocks.context.eventName = 'push'
    mocks.context.payload = { head_commit: { message: 'Merge pull request #42 from some/branch' } }
    mocks.extractPRNumber.mockReturnValue('42')
    mocks.fetchPR.mockResolvedValue(mockPR)
    mocks.getReleaseType.mockReturnValue('minor')
    mocks.getCurrentVersion.mockResolvedValue('1.2.3')
    mocks.getReleaseNotes.mockReturnValue('notes')
    mocks.createRelease.mockResolvedValue('1.3.0')

    await loadIndex()

    expect(mocks.extractPRNumber).toHaveBeenCalledWith('Merge pull request #42 from some/branch')
    expect(mocks.fetchPR).toHaveBeenCalledWith('42', expect.anything())
    expect(mocks.searchPRByCommit).not.toHaveBeenCalled()
    expect(mocks.createRelease).toHaveBeenCalledWith('1.3.0', 'notes', expect.anything())
    expect(mocks.core.setOutput).toHaveBeenCalledWith('version', '1.3.0')
    expect(mocks.core.setOutput).toHaveBeenCalledWith('release-notes', 'notes')
    expect(mocks.core.setOutput).toHaveBeenCalledWith('old-version', '1.2.3')
    expect(mocks.core.setOutput).toHaveBeenCalledWith('skipped', false)
  })

  test('searches for the PR by SHA when the commit message has no PR number', async () => {
    process.env.GITHUB_SHA = 'abc123'
    mocks.getConfig.mockReturnValue(asConfig({ mode: 'bump', v: '' }))
    mocks.context.eventName = 'push'
    mocks.context.payload = { head_commit: { message: 'a regular commit' } }
    mocks.extractPRNumber.mockReturnValue(null)
    mocks.searchPRByCommit.mockResolvedValue(mockPR)
    mocks.getReleaseType.mockReturnValue('minor')
    mocks.getCurrentVersion.mockResolvedValue('1.2.3')
    mocks.getReleaseNotes.mockReturnValue('notes')
    mocks.createRelease.mockResolvedValue('1.3.0')

    await loadIndex()

    expect(mocks.searchPRByCommit).toHaveBeenCalledWith('abc123', expect.anything())
    expect(mocks.fetchPR).not.toHaveBeenCalled()
    expect(mocks.createRelease).toHaveBeenCalled()
    delete process.env.GITHUB_SHA
  })

  test('warns and skips when no PR can be found for the commit', async () => {
    mocks.getConfig.mockReturnValue(asConfig({ mode: 'bump', v: '' }))
    mocks.context.eventName = 'push'
    mocks.context.payload = { head_commit: { message: 'a regular commit' } }
    mocks.extractPRNumber.mockReturnValue(null)
    mocks.searchPRByCommit.mockResolvedValue(null)

    await loadIndex()

    expect(mocks.core.warning).toHaveBeenCalledWith(
      expect.stringContaining("doesn't look like a PR merge"),
    )
    expect(mocks.createRelease).not.toHaveBeenCalled()
  })

  test('skips tagging when the release type is skip', async () => {
    mocks.getConfig.mockReturnValue(asConfig({ mode: 'bump', v: '' }))
    mocks.context.eventName = 'push'
    mocks.context.payload = { head_commit: { message: 'Merge pull request #42 from some/branch' } }
    mocks.extractPRNumber.mockReturnValue('42')
    mocks.fetchPR.mockResolvedValue(mockPR)
    mocks.getReleaseType.mockReturnValue('skip')
    mocks.getCurrentVersion.mockResolvedValue('1.2.3')

    await loadIndex()

    expect(mocks.createRelease).not.toHaveBeenCalled()
    expect(mocks.core.setOutput).toHaveBeenCalledWith('skipped', true)
    expect(mocks.core.setOutput).toHaveBeenCalledWith('old-version', '1.2.3')
    expect(mocks.core.setOutput).not.toHaveBeenCalledWith('version', expect.anything())
  })
})

describe('unknown mode', () => {
  test('is a no-op when the mode is neither validate nor bump', async () => {
    mocks.getConfig.mockReturnValue(asConfig({ mode: 'other' as ActionConfig['mode'], v: '' }))

    await loadIndex()

    expect(mocks.fetchPR).not.toHaveBeenCalled()
    expect(mocks.createRelease).not.toHaveBeenCalled()
    expect(mocks.core.setFailed).not.toHaveBeenCalled()
  })
})

describe('error handling', () => {
  test('reports unexpected errors with their stack trace', async () => {
    const error = new Error('boom')
    error.stack = 'mock stack trace'
    mocks.getConfig.mockImplementation(() => {
      throw error
    })

    await loadIndex()

    expect(mocks.core.info).toHaveBeenCalledWith('mock stack trace')
    expect(mocks.core.setFailed).toHaveBeenCalledWith('unexpected error: boom')
  })

  test('reports unexpected non-Error throws', async () => {
    mocks.getConfig.mockImplementation(() => {
      throw 'kaboom'
    })

    await loadIndex()

    expect(mocks.core.info).toHaveBeenCalledWith('')
    expect(mocks.core.setFailed).toHaveBeenCalledWith('unexpected error: kaboom')
  })
})
