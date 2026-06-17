import * as core from '@actions/core'
import * as github from '@actions/github'
import semver from 'semver'
import { getConfig } from './config'
import { extractPRNumber, fetchPR, getReleaseNotes, getReleaseType, searchPRByCommit } from './pr'
import type { ActionConfig, PullRequest, ReleaseType } from './types'
import { createRelease, getCurrentVersion } from './version'

/** Normalizes an unknown thrown value into a human-readable message. */
export function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** True when the workflow is reacting to an open pull request event. */
export function isActivePR(): boolean {
  return (
    github.context.eventName === 'pull_request' && github.context.payload.pull_request !== undefined
  )
}

/** True when the workflow is reacting to a push that carries a head commit. */
export function isMergeCommit(): boolean {
  return github.context.eventName === 'push' && github.context.payload.head_commit !== undefined
}

/**
 * Validate mode: confirm the active PR carries the metadata required for a
 * release and report the version it would produce. Nothing is tagged.
 */
export async function validateActivePR(config: ActionConfig): Promise<void> {
  const activePR = github.context.payload.pull_request
  if (!isActivePR() || activePR === undefined) {
    core.warning(
      "in 'validate' mode, but this doesn't look like an active PR event (is your workflow misconfigured?)",
    )
    return
  }

  let pr: PullRequest
  try {
    pr = await fetchPR(activePR.number, config)
  } catch (error) {
    core.setFailed(toErrorMessage(error))
    return
  }

  let releaseType: ReleaseType
  try {
    releaseType = getReleaseType(pr, config)
  } catch (error) {
    core.setFailed(`PR validation failed: ${toErrorMessage(error)}`)
    return
  }

  const currentVersion = await getCurrentVersion(config)

  // A no-op/skip label produces no new version on merge, so report the skip and
  // stop. Mirrors bump mode and avoids semver.inc(version, 'skip') returning null.
  if (releaseType === 'skip') {
    core.info(`current version: ${config.v}${currentVersion}`)
    core.info('release is marked as a no-op; no new version would be tagged on merge')
    core.setOutput('old-version', `${config.v}${currentVersion}`)
    core.setOutput('skipped', true)
    return
  }

  let releaseNotes: string
  try {
    releaseNotes = getReleaseNotes(pr, config)
  } catch (error) {
    core.setFailed(`PR validation failed: ${toErrorMessage(error)}`)
    return
  }

  const newVersion = semver.inc(currentVersion, releaseType) as string

  core.info(`current version: ${config.v}${currentVersion}`)
  core.info(`next version: ${config.v}${newVersion}`)
  core.info(`release notes:\n${releaseNotes}`)

  core.setOutput('old-version', `${config.v}${currentVersion}`)
  core.setOutput('version', `${config.v}${newVersion}`)
  core.setOutput('release-notes', releaseNotes)
  core.setOutput('skipped', false)
}

/**
 * Bump mode: resolve the merged PR behind the head commit and, unless its
 * label marks the release as skipped, tag a new annotated version.
 */
export async function bumpAndTagNewVersion(config: ActionConfig): Promise<void> {
  if (!isMergeCommit()) {
    core.warning(
      "in 'bump' mode, but this doesn't look like a PR merge commit event (is your workflow misconfigured?)",
    )
    return
  }

  const prNumber = extractPRNumber(github.context.payload.head_commit.message)
  let pr: PullRequest
  if (prNumber == null) {
    core.info('Unable to determine PR from commit msg, searching for PR by SHA')
    // Rebase merges leave no PR reference in the commit message; fall back to a SHA search.
    const matchedPR = await searchPRByCommit(process.env.GITHUB_SHA, config)
    if (matchedPR == null) {
      // Don't fail the job for an unrelated commit, but make the skip visible.
      // Might be a good point for configuration in the future.
      core.warning("head commit doesn't look like a PR merge, skipping version bumping and tagging")
      return
    }
    pr = matchedPR
  } else {
    pr = await fetchPR(prNumber, config)
  }

  core.info(`Processing version bump for PR #${pr.number}`)
  const releaseType = getReleaseType(pr, config)
  const currentVersion = await getCurrentVersion(config)

  // A skipped release records the current version but creates no new tag.
  if (releaseType !== 'skip') {
    const releaseNotes = getReleaseNotes(pr, config)
    const newVersion = semver.inc(currentVersion, releaseType) as string
    const newTag = await createRelease(newVersion, releaseNotes, config)
    core.info(`Created release tag ${newTag} with the following release notes:\n${releaseNotes}\n`)

    core.setOutput('version', newTag)
    core.setOutput('release-notes', releaseNotes)
  }

  core.setOutput('old-version', `${config.v}${currentVersion}`)
  core.setOutput('skipped', releaseType === 'skip')
}

/** Action entrypoint: load config and dispatch to the requested mode. */
export async function run(): Promise<void> {
  try {
    const config = getConfig()
    if (config.mode === 'validate') {
      await validateActivePR(config)
    } else if (config.mode === 'bump') {
      await bumpAndTagNewVersion(config)
    }
  } catch (error) {
    const stack = error instanceof Error ? error.stack : undefined
    core.info(stack ?? '')
    core.setFailed(`unexpected error: ${toErrorMessage(error)}`)
  }
}

run()
