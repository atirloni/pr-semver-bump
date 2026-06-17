import * as core from '@actions/core'
import * as github from '@actions/github'
import semver from 'semver'
import type { ActionConfig, GitRefObject } from './types'

/** Version reported when the repository has no usable version tags yet. */
const DEFAULT_VERSION = '0.0.0'

/** Collects the SHAs of every commit reachable from the given branch. */
async function getCommitsOnBranch(
  branch: string,
  config: Pick<ActionConfig, 'octokit'>,
): Promise<Set<string>> {
  const commits = new Set<string>()
  for await (const response of config.octokit.paginate.iterator(
    config.octokit.rest.repos.listCommits,
    { ...github.context.repo, sha: branch },
  )) {
    for (const commit of response.data) {
      commits.add(commit.sha)
    }
  }
  return commits
}

/**
 * Walks versions newest-first and returns the first one whose tag points at a
 * commit on the branch.
 *
 * Annotated tags are dereferenced to the commit they wrap before comparing.
 *
 * @returns The matching version, or {@link DEFAULT_VERSION} if none match.
 */
async function getLatestVersionInCommits(
  commits: Set<string>,
  sortedVersions: semver.SemVer[],
  objectsByVersion: Record<string, GitRefObject>,
  config: Pick<ActionConfig, 'octokit'>,
): Promise<string> {
  for (const parsedVersion of sortedVersions) {
    const version = `${parsedVersion}`
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

/**
 * Tags the given version at the current commit and annotates it with the
 * release notes.
 *
 * @returns The created tag name (prefixed with `v` when configured).
 */
export async function createRelease(
  version: string,
  releaseNotes: string,
  config: Pick<ActionConfig, 'octokit' | 'v'>,
): Promise<string> {
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

/**
 * Finds the most recent tagged semantic version in the repository.
 *
 * When `baseBranch` is set, only tags reachable from the PR base branch are
 * considered; otherwise the highest version tag wins.
 *
 * @returns The current version, or {@link DEFAULT_VERSION} when none is found.
 */
export async function getCurrentVersion(
  config: Pick<ActionConfig, 'octokit' | 'baseBranch'>,
): Promise<string> {
  const matchingRefs = await config.octokit.rest.git.listMatchingRefs({
    ...github.context.repo,
    ref: 'tags/',
  })

  const objectsByVersion: Record<string, GitRefObject> = {}
  const versions: semver.SemVer[] = []

  for (const ref of matchingRefs.data) {
    const version = semver.parse(ref.ref.replace(/^refs\/tags\//g, ''), { loose: true })
    if (version === null) {
      continue
    }
    if (ref.object !== undefined) {
      objectsByVersion[`${version}`] = ref.object as GitRefObject
    }
    versions.push(version)
  }

  // Sort descending so the newest version is first.
  versions.sort(semver.rcompare)

  if (config.baseBranch) {
    const branch = process.env.GITHUB_BASE_REF || process.env.GITHUB_REF?.replace('refs/heads/', '')
    core.info(`Only considering tags on branch ${branch}`)
    const commits = await getCommitsOnBranch(branch as string, config)
    return getLatestVersionInCommits(commits, versions, objectsByVersion, config)
  }

  return versions[0] !== undefined ? `${versions[0]}` : DEFAULT_VERSION
}
