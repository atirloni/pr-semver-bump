import { describe, expect, test, vi } from 'vitest'
import { extractPRNumber, fetchPR, getReleaseNotes, getReleaseType, searchPRByCommit } from './pr'
import type { ActionConfig } from './types'

function asConfig(config: unknown) {
  return config as Pick<ActionConfig, 'octokit'>
}

test('can extract a PR number from a PR merge commit message', () => {
  expect(extractPRNumber('Merge pull request #4 from some/mockBranch')).toEqual('4')
  expect(extractPRNumber('Merge pull request #42 from some/mockBranch')).toEqual('42')
})

test('can extract a PR number from a squash merge commit message', () => {
  expect(extractPRNumber('My PR squashed (#56)')).toEqual('56')
  expect(extractPRNumber('Squash pr (#45)\n\n multiple commit messages appended')).toEqual('45')
})

test('returns null if no PR number is found in a commit message', () => {
  expect(extractPRNumber('Merge branch master into some/mockBranch')).toEqual(null)
})

test('searchPRByCommit returns a PR', async () => {
  const sha = '123456789'
  const issuesAndPullRequests = vi.fn(async (options: { q: string }) => ({
    data: {
      total_count: 1,
      items: [{ number: 15, id: sha }],
      query: options.q,
    },
  }))
  const config = asConfig({
    octokit: {
      rest: {
        search: {
          issuesAndPullRequests,
        },
      },
    },
  })

  await expect(searchPRByCommit(sha, config)).resolves.toEqual({ number: 15, id: sha })
  expect(issuesAndPullRequests).toHaveBeenCalledWith({ q: `type:pr is:merged ${sha}` })
})

test('searchPRByCommit returns null when no PR matches the commit', async () => {
  const sha = '123456789'
  const config = asConfig({
    octokit: {
      rest: {
        search: {
          issuesAndPullRequests: async () => ({ data: { total_count: 0 } }),
        },
      },
    },
  })

  await expect(searchPRByCommit(sha, config)).resolves.toBeNull()
})

test('searchPRByCommit throws an error on query', async () => {
  const sha = '123456789'
  const config = asConfig({
    octokit: {
      rest: {
        search: {
          issuesAndPullRequests: async () => {
            throw new Error('mock error')
          },
        },
      },
    },
  })

  await expect(searchPRByCommit(sha, config)).rejects.toThrow(
    `Failed to find PR by commit SHA ${sha}: mock error`,
  )
})

test('can fetch PR data', async () => {
  process.env.GITHUB_REPOSITORY = 'mockUser/mockRepo'
  const pullsGet = vi.fn(async (options: { pull_number: number }) => ({
    data: { number: options.pull_number },
  }))
  const config = asConfig({
    octokit: {
      rest: {
        pulls: {
          get: pullsGet,
        },
      },
    },
  })

  await expect(fetchPR(42, config)).resolves.toEqual({ number: 42 })
  expect(pullsGet).toHaveBeenCalledWith({
    owner: 'mockUser',
    repo: 'mockRepo',
    pull_number: 42,
  })
})

test('throws when fetching PR data fails', async () => {
  process.env.GITHUB_REPOSITORY = 'mockUser/mockRepo'
  const config = asConfig({
    octokit: {
      rest: {
        pulls: {
          get: async () => {
            throw new Error('mock error')
          },
        },
      },
    },
  })

  await expect(fetchPR(42, config)).rejects.toThrow('failed to fetch data for PR #42: mock error')
})

test('can get release type', () => {
  const mockPR = {
    labels: [
      { name: 'mock-major-label' },
      { name: 'not-release-related' },
      { name: 'another one' },
    ],
  }
  const config = {
    releaseLabels: {
      'mock-major-label': 'major',
      'mock-minor-label': 'minor',
      'mock-patch-label': 'patch',
    },
    noopLabels: {},
  } as const

  const type = getReleaseType(mockPR, config)
  expect(type).toEqual('major')
})

test('can get release type with noop labels', () => {
  const mockPR = {
    labels: [
      { name: 'mock-major-label' },
      { name: 'not-release-related' },
      { name: 'another one' },
    ],
  }
  const config = {
    releaseLabels: {
      'mock-major-label': 'major',
      'mock-minor-label': 'minor',
      'mock-patch-label': 'patch',
    },
    noopLabels: {
      'documentation change': 'skipped',
    },
  } as unknown as Pick<ActionConfig, 'releaseLabels' | 'noopLabels'>

  const type = getReleaseType(mockPR, config)
  expect(type).toEqual('major')
})

test('can get release type with only noop labels', () => {
  const mockPR = {
    labels: [{ name: 'not-release-related' }, { name: 'documentation change' }],
  }
  const config = {
    releaseLabels: {
      'mock-major-label': 'major',
      'mock-minor-label': 'minor',
      'mock-patch-label': 'patch',
    },
    noopLabels: {
      'documentation change': 'skip',
    },
  } as const

  const type = getReleaseType(mockPR, config)
  expect(type).toEqual('skip')
})

test('throws if no valid release label is present', () => {
  const mockPR = {
    labels: [{ name: 'some-label' }, { name: 'not-release-related' }, { name: 'another one' }],
  }
  const config = {
    releaseLabels: {
      'mock-major-label': 'major',
      'mock-minor-label': 'minor',
      'mock-patch-label': 'patch',
    },
    noopLabels: {},
  } as const

  expect(() => {
    getReleaseType(mockPR, config)
  }).toThrow('no release label specified on PR')
})

test('throws if multiple valid release labels are present', () => {
  const mockPR = {
    labels: [
      { name: 'mock-major-label' },
      { name: 'not-release-related' },
      { name: 'mock-patch-label' },
    ],
  }
  const config = {
    releaseLabels: {
      'mock-major-label': 'major',
      'mock-minor-label': 'minor',
      'mock-patch-label': 'patch',
    },
    noopLabels: {},
  } as const

  expect(() => {
    getReleaseType(mockPR, config)
  }).toThrow('too many release labels specified on PR')
})

test('throws if both a valid release label and a noop label are present', () => {
  const mockPR = {
    labels: [
      { name: 'mock-major-label' },
      { name: 'not-release-related' },
      { name: 'documentation change' },
    ],
  }
  const config = {
    releaseLabels: {
      'mock-major-label': 'major',
      'mock-minor-label': 'minor',
      'mock-patch-label': 'patch',
    },
    noopLabels: {
      'documentation change': 'skipped',
    },
  } as unknown as Pick<ActionConfig, 'releaseLabels' | 'noopLabels'>

  expect(() => {
    getReleaseType(mockPR, config)
  }).toThrow('too many labels specified, both release labels and noop labels specified')
})

describe('can parse release notes', () => {
  const cases = [
    {
      name: 'when body is empty',
      body: '',
      before: '',
      after: '',
      expected: '',
    },
    {
      name: 'from a single line body',
      body: 'a single line body',
      before: '',
      after: '',
      expected: 'a single line body',
    },
    {
      name: 'from a single line body with surrounding whitespace',
      body: ' \t a single line body within whitespace \t ',
      before: '',
      after: '',
      expected: 'a single line body within whitespace',
    },
    {
      name: 'from a multline body',
      body: 'a multiple\nline body with\n\n newlines',
      before: '',
      after: '',
      expected: 'a multiple\nline body with\n\n newlines',
    },
    {
      name: 'from a multiline body with surrounding whitespace',
      body: ' \t\n a multiple\nline body with\n\n newlines within whitespace \t\n ',
      before: '',
      after: '',
      expected: 'a multiple\nline body with\n\n newlines within whitespace',
    },
    {
      name: 'from a multiline body containing single line notes using a prefix',
      body: 'before\n\n--begin--\n\na single line\n\n--end---\n\nafter',
      before: '--begin--',
      after: '',
      expected: 'a single line\n\n--end---\n\nafter',
    },
    {
      name: 'from a multiline body containing multiline notes using a prefix',
      body: 'before\n\n--begin--\n\nmany\ndifferent lines\n\nhere\n\n--end---\n\nafter',
      before: '--begin--',
      after: '',
      expected: 'many\ndifferent lines\n\nhere\n\n--end---\n\nafter',
    },
    {
      name: 'from a single line body containing single line notes using a prefix and suffix',
      body: 'before\n\n--begin--\n\na single line\n\n--end---\n\nafter',
      before: '',
      after: '--end--',
      expected: 'before\n\n--begin--\n\na single line',
    },
    {
      name: 'from a multiline body containing multiline notes using a suffix',
      body: 'before\n\n--begin--\n\nmany\ndifferent lines\n\nhere\n\n--end---\n\nafter',
      before: '',
      after: '--end--',
      expected: 'before\n\n--begin--\n\nmany\ndifferent lines\n\nhere',
    },
    {
      name: 'from a body using a prefix and suffix',
      body: 'before\n\n--begin--\n\na single line\n\n--end---\n\nafter',
      before: '--begin--',
      after: '--end--',
      expected: 'a single line',
    },
    {
      name: 'No message if the prefix and suffix are defined but dont appear in the body',
      body: 'a single line both',
      before: '--begin--',
      after: '--end--',
      expected: '',
    },
    {
      name: 'No message if the prefix is defined but doesnt appear in the body',
      body: 'a single line prefix',
      before: '--begin--',
      after: '',
      expected: '',
    },
    {
      name: 'No message if the suffix is defined but doesnt appear in the body',
      body: 'a single line suffix',
      before: '',
      after: '--after--',
      expected: '',
    },
    {
      name: 'with multiline notes from a multiline body using a prefix and suffix',
      body: 'before\n\n--begin--\n\nmany\ndifferent lines\n\nhere\n\n--end---\n\nafter',
      before: '--begin--',
      after: '--end--',
      expected: 'many\ndifferent lines\n\nhere',
    },
    {
      name: 'with multiline notes from a multiline body using line-matching patterns',
      body: 'before\n\n--begin--\n\nmany\ndifferent lines\n\nhere\n\n--anything--\n\nafter',
      before: '^--begin--$',
      after: '^--[^-]',
      expected: 'many\ndifferent lines\n\nhere',
    },
  ]

  test.each(cases)('$name', ({ body, before, after, expected }) => {
    const config = {
      requireReleaseNotes: false,
      releaseNotesPrefixPattern: before === '' ? undefined : new RegExp(before),
      releaseNotesSuffixPattern: after === '' ? undefined : new RegExp(after),
    }

    expect(getReleaseNotes({ body }, config)).toBe(expected)
  })
})

test('returns empty release notes if not required and not found, empty, or null', () => {
  const bodies = ['', '--begin--\n--end--', null]
  const config = {
    releaseNotesPrefixPattern: /--begin--/,
    releaseNotesSuffixPattern: /--end--/,
    requireReleaseNotes: false,
  }

  bodies.forEach((body) => {
    const notes = getReleaseNotes({ body }, config)
    expect(notes).toBe('')
  })
})

test('throws if release notes required but not found or empty', () => {
  const cases = [
    {
      name: 'when body is empty and no prefix or suffix defined',
      body: '',
      before: '',
      after: '',
    },
    {
      name: 'when body is empty and a prefix and suffix defined',
      body: '',
      before: '--begin--',
      after: '--end--',
    },
    {
      name: 'when body is empty and only a prefix defined',
      body: '',
      before: '--begin--',
      after: '',
    },
    {
      name: 'when body is empty and only a suffix defined',
      body: '',
      before: '',
      after: '--end--',
    },
    {
      name: 'when body is not empty and a prefix and suffix defined',
      body: 'this is the body',
      before: '--begin--',
      after: '--end--',
    },
    {
      name: 'when body is not empty and a prefix and suffix defined and used at end',
      body: 'this is the body--begin--\n--end--',
      before: '--begin--',
      after: '--end--',
    },
    {
      name: 'when body is not empty and a prefix and suffix defined and used at beginning',
      body: '--begin--\n--end--\nthis is the body',
      before: '--begin--',
      after: '--end--',
    },
    {
      name: 'when body is not empty and a prefix and suffix defined and used in the middle',
      body: 'this is\n--begin--\n--end--\nthe body',
      before: '--begin--',
      after: '--end--',
    },
    {
      name: 'when body is not empty and a prefix and suffix defined, only begin is used',
      body: 'this is the body\n--begin--',
      before: '--begin--',
      after: '--end--',
    },
    {
      name: 'when body is not empty and a prefix and suffix defined, only end is used',
      body: '--end--\nthis is the body',
      before: '--begin--',
      after: '--end--',
    },
    {
      name: 'when body is not empty and only a prefix defined',
      body: 'this is the body',
      before: '--begin--',
      after: '',
    },
    {
      name: 'when body is not empty and only a prefix defined and used at end',
      body: 'this is the body\n--begin--',
      before: '--begin--',
      after: '',
    },
    {
      name: 'when body is not empty and only a suffix defined',
      body: 'this is the body',
      before: '',
      after: '--end--',
    },
    {
      name: 'when body is not empty and only a suffix defined and used at start',
      body: '--end--\nthis is the body',
      before: '',
      after: '--end--',
    },
  ]

  cases.forEach(({ body, before, after }) => {
    const config = {
      requireReleaseNotes: true,
      releaseNotesPrefixPattern: before === '' ? undefined : new RegExp(before),
      releaseNotesSuffixPattern: after === '' ? undefined : new RegExp(after),
    }

    expect(() => {
      getReleaseNotes({ body }, config)
    }).toThrow('missing release notes')
  })
})
