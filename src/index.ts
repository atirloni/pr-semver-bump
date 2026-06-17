import * as core from '@actions/core'
import * as github from '@actions/github'
import semver from 'semver'
import { getConfig } from './config'
import { extractPRNumber, fetchPR, getReleaseNotes, getReleaseType, searchPRByCommit } from './pr'
import type { ActionConfig, PullRequest, ReleaseType } from './types'
import { createRelease, getCurrentVersion } from './version'

// Returns true if the current context looks like an active PR.
function isActivePR() {
  return (
    github.context.eventName === 'pull_request' && github.context.payload.pull_request !== undefined
  )
}

// Returns true if the current context looks like a merge commit.
function isMergeCommit() {
  return github.context.eventName === 'push' && github.context.payload.head_commit !== undefined
}

// Ensures that the currently active PR contains the required release metadata.
async function validateActivePR(config: ActionConfig) {
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
    const message = error instanceof Error ? error.message : String(error)
    core.setFailed(message)
    return
  }

  let releaseType: ReleaseType
  let releaseNotes: string
  try {
    releaseType = getReleaseType(pr, config)
    releaseNotes = getReleaseNotes(pr, config)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    core.setFailed(`PR validation failed: ${message}`)
    return
  }

  const currentVersion = await getCurrentVersion(config)
  const newVersion = semver.inc(currentVersion, releaseType as semver.ReleaseType)

  core.info(`current version: ${config.v}${currentVersion}`)
  core.info(`next version: ${config.v}${newVersion}`)
  core.info(`release notes:\n${releaseNotes}`)

  core.setOutput('old-version', `${config.v}${currentVersion}`)
  core.setOutput('version', `${config.v}${newVersion}`)
  core.setOutput('release-notes', releaseNotes)
}

// Increments the version according to the release type and tags a new version with release notes.
async function bumpAndTagNewVersion(config: ActionConfig) {
  if (!isMergeCommit()) {
    core.warning(
      "in 'bump' mode, but this doesn't look like a PR merge commit event (is your workflow misconfigured?)",
    )
    return
  }

  const num = extractPRNumber(github.context.payload.head_commit.message)
  let pr: PullRequest
  if (num == null) {
    core.info('Unable to determine PR from commit msg, searching for PR by SHA')
    // Try to search the commit sha for the PR number.
    pr = await searchPRByCommit(process.env.GITHUB_SHA, config)
    if (pr == null) {
      // Don't want to fail the job if some other commit comes in, but let's warn about it.
      // Might be a good point for configuration in the future.
      core.warning("head commit doesn't look like a PR merge, skipping version bumping and tagging")
      return
    }
  } else {
    pr = await fetchPR(num, config)
  }
  core.info(`Processing version bump for PR request #${pr.number}`)
  const releaseType = getReleaseType(pr, config)
  // If the release is skipped, we do not create a new tag.
  const currentVersion = await getCurrentVersion(config)
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

async function run() {
  try {
    const config = getConfig()
    if (config.mode === 'validate') {
      await validateActivePR(config)
    } else if (config.mode === 'bump') {
      await bumpAndTagNewVersion(config)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const stack = error instanceof Error ? error.stack : undefined
    core.info(stack ?? '')
    core.setFailed(`unexpected error: ${message}`)
  }
}

run()
