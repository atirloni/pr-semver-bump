import * as core from '@actions/core'
import * as github from '@actions/github'
import type { ActionConfig, Mode, VersionReleaseType } from './types'

// Gets all the required inputs and validates them before proceeding.
export function getConfig(): ActionConfig {
  const mode = core.getInput('mode', { required: true }).toLowerCase()
  if (mode !== 'validate' && mode !== 'bump') {
    throw new Error("mode must be either 'validate' or 'bump'")
  }

  const token = core.getInput('repo-token', { required: true })
  core.setSecret(token)

  const releaseNotesPrefix = core.getInput('release-notes-prefix')
  const releaseNotesSuffix = core.getInput('release-notes-suffix')

  let releaseNotesPrefixPattern: RegExp | undefined
  if (releaseNotesPrefix !== undefined && releaseNotesPrefix !== '') {
    releaseNotesPrefixPattern = new RegExp(releaseNotesPrefix)
  }

  let releaseNotesSuffixPattern: RegExp | undefined
  if (releaseNotesSuffix !== undefined && releaseNotesSuffix !== '') {
    releaseNotesSuffixPattern = new RegExp(releaseNotesSuffix)
  }

  const releaseLabels: Record<string, VersionReleaseType> = {}
  releaseLabels[core.getInput('major-label') || 'major release'] = 'major'
  releaseLabels[core.getInput('minor-label') || 'minor release'] = 'minor'
  releaseLabels[core.getInput('patch-label') || 'patch release'] = 'patch'

  const noopLabels: Record<string, 'skip'> = {}
  const configuredNoopLabels = core.getMultilineInput('noop-labels', { trimWhitespace: true })
  for (let i = 0; i < configuredNoopLabels.length; i++) {
    noopLabels[configuredNoopLabels[i]] = 'skip'
  }

  return {
    mode: mode as Mode,
    octokit: github.getOctokit(token),
    releaseLabels,
    noopLabels,
    releaseNotesPrefixPattern,
    releaseNotesSuffixPattern,
    requireReleaseNotes: core.getInput('require-release-notes').toLowerCase() === 'true',
    baseBranch: core.getInput('base-branch').toLowerCase() === 'true',
    v: core.getInput('with-v').toLowerCase() === 'true' ? 'v' : '',
  }
}
