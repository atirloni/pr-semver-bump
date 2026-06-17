import * as core from '@actions/core'
import * as github from '@actions/github'
import type { ActionConfig, VersionReleaseType } from './types'

/** Compiles a non-empty input into a RegExp; blank input yields no pattern. */
function compilePattern(input: string): RegExp | undefined {
  return input === '' ? undefined : new RegExp(input)
}

/** Reads a boolean input, treating only the literal `'true'` as true (case-insensitive). */
function parseBooleanInput(name: string): boolean {
  return core.getInput(name).toLowerCase() === 'true'
}

/** Maps each configured (or default) release label to the bump it triggers. */
function buildReleaseLabels(): Record<string, VersionReleaseType> {
  return {
    [core.getInput('major-label') || 'major release']: 'major',
    [core.getInput('minor-label') || 'minor release']: 'minor',
    [core.getInput('patch-label') || 'patch release']: 'patch',
  }
}

/** Maps each configured no-op label to `'skip'`, marking PRs that skip a release. */
function buildNoopLabels(): Record<string, 'skip'> {
  const noopLabels: Record<string, 'skip'> = {}
  for (const name of core.getMultilineInput('noop-labels', { trimWhitespace: true })) {
    noopLabels[name] = 'skip'
  }
  return noopLabels
}

/**
 * Reads and validates all action inputs into a single {@link ActionConfig}.
 *
 * @throws If `mode` is missing or is anything other than `validate`/`bump`.
 */
export function getConfig(): ActionConfig {
  const mode = core.getInput('mode', { required: true }).toLowerCase()
  if (mode !== 'validate' && mode !== 'bump') {
    throw new Error("mode must be either 'validate' or 'bump'")
  }

  const token = core.getInput('repo-token', { required: true })
  core.setSecret(token)

  return {
    mode,
    octokit: github.getOctokit(token),
    releaseLabels: buildReleaseLabels(),
    noopLabels: buildNoopLabels(),
    releaseNotesPrefixPattern: compilePattern(core.getInput('release-notes-prefix')),
    releaseNotesSuffixPattern: compilePattern(core.getInput('release-notes-suffix')),
    requireReleaseNotes: parseBooleanInput('require-release-notes'),
    baseBranch: parseBooleanInput('base-branch'),
    v: parseBooleanInput('with-v') ? 'v' : '',
  }
}
