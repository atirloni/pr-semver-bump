import { expect, test, vi } from 'vitest'
import type { ActionConfig } from './types'
import { createRelease, getCurrentVersion } from './version'

function asConfig(config: unknown) {
  return config as Pick<ActionConfig, 'octokit' | 'baseBranch' | 'v'>
}

test('can get the current version when version tags are available', async () => {
  process.env.GITHUB_REPOSITORY = 'mockUser/mockRepo'
  const config = asConfig({
    octokit: {
      rest: {
        git: {
          listMatchingRefs: async () => ({
            data: [
              { ref: 'refs/tags/v1.2.3' },
              { ref: 'refs/tags/myFeature' },
              { ref: 'refs/tags/v1.4.0' },
              { ref: 'refs/tags/not-a-version' },
              { ref: 'refs/tags/v1.4.1' },
              { ref: 'refs/tags/very-good-tag' },
            ],
          }),
        },
      },
    },
  })

  await expect(getCurrentVersion(config)).resolves.toBe('1.4.1')
})

test('returns a default version when version tags are unavailable', async () => {
  process.env.GITHUB_REPOSITORY = 'mockUser/mockRepo'
  const config = asConfig({
    octokit: {
      rest: {
        git: {
          listMatchingRefs: async () => ({
            data: [
              { ref: 'refs/tags/myFeature' },
              { ref: 'refs/tags/not-a-version' },
              { ref: 'refs/tags/very-good-tag' },
            ],
          }),
        },
      },
    },
  })

  await expect(getCurrentVersion(config)).resolves.toBe('0.0.0')
})

const baseBranchCases = [
  [
    {
      matchingRefs: [
        {
          ref: 'refs/tags/v1.2.3',
          object: {
            type: 'commit',
            sha: 'mockCommit1',
          },
        },
        {
          ref: 'refs/tags/myFeature',
        },
        {
          ref: 'refs/tags/v1.4.0',
          object: {
            type: 'commit',
            sha: 'mockCommit2',
          },
        },
        {
          ref: 'refs/tags/not-a-version',
        },
        {
          ref: 'refs/tags/v1.4.1',
          object: {
            type: 'tag',
            sha: 'mockTag1',
          },
        },
        {
          ref: 'refs/tags/very-good-tag',
        },
      ],
      getTagSha: 'mockCommit3',
      commitsOnBranch: [{ sha: 'mockCommit1' }, { sha: 'mockCommit2' }],
    },
    '1.4.0',
  ],
  [
    {
      matchingRefs: [
        {
          ref: 'refs/tags/v1.2.3',
          object: {
            type: 'commit',
            sha: 'mockCommit1',
          },
        },
        {
          ref: 'refs/tags/v1.4.0',
          object: {
            type: 'tag',
            sha: 'mockTag1',
          },
        },
        {
          ref: 'refs/tags/v1.4.1',
          object: {
            type: 'commit',
            sha: 'mockCommit3',
          },
        },
      ],
      getTagSha: 'mockCommit2',
      commitsOnBranch: [{ sha: 'mockCommit1' }, { sha: 'mockCommit2' }],
    },
    '1.4.0',
  ],
  [
    {
      matchingRefs: [
        {
          ref: 'refs/tags/v1.2.3',
          object: {
            type: 'commit',
            sha: 'mockCommit3',
          },
        },
      ],
      commitsOnBranch: [{ sha: 'mockCommit1' }, { sha: 'mockCommit2' }],
    },
    '0.0.0',
  ],
] as const

test.each(baseBranchCases)('returns the latest version on a branch', async (input, expected) => {
  process.env.GITHUB_REPOSITORY = 'mockUser/mockRepo'
  process.env.GITHUB_REF = 'refs/heads/mockBranch'

  async function* asyncGenerator(fn: () => Promise<{ data: { sha: string }[] }>) {
    yield await fn()
  }
  const config = asConfig({
    baseBranch: true,
    octokit: {
      paginate: {
        iterator: asyncGenerator,
      },
      rest: {
        git: {
          listMatchingRefs: async () => ({
            data: input.matchingRefs,
          }),
          getTag: async () => ({
            data: {
              object: {
                sha: 'getTagSha' in input ? input.getTagSha : 'unusedTagSha',
              },
            },
          }),
        },
        repos: {
          listCommits: async () => ({
            data: input.commitsOnBranch,
          }),
        },
      },
    },
  })

  await expect(getCurrentVersion(config)).resolves.toBe(expected)
})

test('uses GITHUB_BASE_REF before GITHUB_REF when filtering by branch', async () => {
  process.env.GITHUB_REPOSITORY = 'mockUser/mockRepo'
  process.env.GITHUB_REF = 'refs/heads/fallbackBranch'
  process.env.GITHUB_BASE_REF = 'baseBranch'
  const listCommits = vi.fn(async () => ({ data: [{ sha: 'mockCommit1' }] }))

  const config = asConfig({
    baseBranch: true,
    octokit: {
      paginate: {
        iterator: async function* (
          fn: (options: unknown) => Promise<{ data: { sha: string }[] }>,
          options: unknown,
        ) {
          yield await fn(options)
        },
      },
      rest: {
        git: {
          listMatchingRefs: async () => ({
            data: [
              {
                ref: 'refs/tags/v1.2.3',
                object: {
                  type: 'commit',
                  sha: 'mockCommit1',
                },
              },
            ],
          }),
        },
        repos: {
          listCommits,
        },
      },
    },
  })

  await expect(getCurrentVersion(config)).resolves.toBe('1.2.3')
  expect(listCommits).toHaveBeenCalledWith({
    owner: 'mockUser',
    repo: 'mockRepo',
    sha: 'baseBranch',
  })
  delete process.env.GITHUB_BASE_REF
})

test('can create a new release', async () => {
  process.env.GITHUB_REPOSITORY = 'mockUser/mockRepo'
  process.env.GITHUB_SHA = 'mockTargetSha'
  const createTag = vi.fn(async () => ({ data: { sha: 'mockSha' } }))
  const createRef = vi.fn(async () => ({}))
  const config = asConfig({
    octokit: {
      rest: {
        git: {
          createTag,
          createRef,
        },
      },
    },
  })

  config.v = ''
  await expect(createRelease('1.2.3', 'mock release notes', config)).resolves.toBe('1.2.3')
  config.v = 'v'
  await expect(createRelease('1.2.3', 'mock release notes', config)).resolves.toBe('v1.2.3')
  expect(createTag).toHaveBeenCalledWith({
    owner: 'mockUser',
    repo: 'mockRepo',
    tag: '1.2.3',
    message: 'mock release notes',
    object: 'mockTargetSha',
    type: 'commit',
  })
  expect(createRef).toHaveBeenCalledWith({
    owner: 'mockUser',
    repo: 'mockRepo',
    ref: 'refs/tags/v1.2.3',
    sha: 'mockSha',
  })
})
