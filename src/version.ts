import * as core from '@actions/core'
import * as github from '@actions/github'
import semver from 'semver'
import type { ActionConfig, GitRefObject } from './types'

const DEFAULT_VERSION = '0.0.0'

async function getCommitsOnBranch(branch: string, config: Pick<ActionConfig, 'octokit'>) {
  const commits = new Set<string>()
  for await (const response of config.octokit.paginate.iterator(
    config.octokit.rest.repos.listCommits,
    {
      ...github.context.repo,
      sha: branch,
    },
  )) {
    response.data.forEach((commit) => {
      commits.add(commit.sha)
    })
  }
  return commits
}

async function getLatestVersionInCommits(
  commits: Set<string>,
  sortedVersions: semver.SemVer[],
  objectsByVersion: Record<string, GitRefObject>,
  config: Pick<ActionConfig, 'octokit'>,
) {
  for (let i = 0; i < sortedVersions.length; i++) {
    const version = `${sortedVersions[i]}`
    const refObj = objectsByVersion[version]

    if (refObj.type === 'commit' && commits.has(refObj.sha)) {
      return version
    }

    if (refObj.type === 'tag') {
      const tag = await config.octokit.rest.git.getTag({
        ...github.context.repo,
        tag_sha: refObj.sha,
      })

      if (commits.has(tag.data.object.sha)) {
        return version
      }
    }
  }

  return DEFAULT_VERSION
}

// Tags the specified version and annotates it with the provided release notes.
export async function createRelease(
  version: string,
  releaseNotes: string,
  config: Pick<ActionConfig, 'octokit' | 'v'>,
) {
  const tag = `${config.v}${version}`
  const tagCreateResponse = await config.octokit.rest.git.createTag({
    ...github.context.repo,
    tag,
    message: releaseNotes,
    object: process.env.GITHUB_SHA as string,
    type: 'commit',
  })

  await config.octokit.rest.git.createRef({
    ...github.context.repo,
    ref: `refs/tags/${tag}`,
    sha: tagCreateResponse.data.sha,
  })

  return tag
}

// Returns the most recent tagged version in git.
export async function getCurrentVersion(config: Pick<ActionConfig, 'octokit' | 'baseBranch'>) {
  const data = await config.octokit.rest.git.listMatchingRefs({
    ...github.context.repo,
    ref: 'tags/',
  })

  const objectsByVersion: Record<string, GitRefObject> = {}
  const versions: semver.SemVer[] = []

  data.data.forEach((ref) => {
    const version = semver.parse(ref.ref.replace(/^refs\/tags\//g, ''), { loose: true })

    if (version !== null) {
      if (ref.object !== undefined) {
        objectsByVersion[`${version}`] = ref.object as GitRefObject
      }
      versions.push(version)
    }
  })

  versions.sort(semver.rcompare)

  if (config.baseBranch) {
    const branch = process.env.GITHUB_BASE_REF || process.env.GITHUB_REF?.replace('refs/heads/', '')
    core.info(`Only considering tags on branch ${branch}`)
    const commits = await getCommitsOnBranch(branch as string, config)
    return getLatestVersionInCommits(commits, versions, objectsByVersion, config)
  }

  if (versions[0] !== undefined) {
    return `${versions[0]}`
  }

  return DEFAULT_VERSION
}
