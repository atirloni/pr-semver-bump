import * as github from '@actions/github'
import type { ActionConfig, PullRequest, ReleaseType } from './types'

// Returns the PR number from a commit message, or null if one can't be found.
export function extractPRNumber(commitMsg: string): string | null {
  const re = /Merge pull request #(\d+) from/
  const matches = commitMsg.match(re)
  if (matches !== null && matches.length > 1) {
    return matches[1].trim()
  }

  // Squash Merges do not have the merge pull request commit message
  // but use the PR Title (#<pr num>) syntax by default.
  const squashRE = /\(#(\d+)\)/
  const squashMatches = commitMsg.match(squashRE)
  if (squashMatches !== null && squashMatches.length > 1) {
    return squashMatches[1].trim()
  }

  return null
}

export async function searchPRByCommit(
  commitSHA: string | undefined,
  config: Pick<ActionConfig, 'octokit'>,
): Promise<PullRequest> {
  // Query GitHub to see if the commit sha is related to a PR.
  // Rebase merge will not have the information in the commit message.
  try {
    const q = `type:pr is:merged ${commitSHA}`
    const data = await config.octokit.rest.search.issuesAndPullRequests({ q })

    if (data.data.total_count < 1) {
      throw new Error('No results found querying for the PR')
    }

    // We should only find one PR with the commit SHA that was merged so take the first one.
    const pr = data.data.items[0]
    return pr as PullRequest
  } catch (fetchError) {
    const message = (fetchError as Error).message
    throw new Error(`Failed to find PR by commit SHA ${commitSHA}: ${message}`)
  }
}

// Fetches the details of a pull request.
export async function fetchPR(
  num: number | string,
  config: Pick<ActionConfig, 'octokit'>,
): Promise<PullRequest> {
  try {
    const data = await config.octokit.rest.pulls.get({
      ...github.context.repo,
      pull_number: Number(num),
    })

    return data.data as PullRequest
  } catch (fetchError) {
    const message = (fetchError as Error).message
    throw new Error(`failed to fetch data for PR #${num}: ${message}`)
  }
}

// Returns the release type (major, minor, patch or skip) based on the labels in the PR.
export function getReleaseType(
  pr: Pick<PullRequest, 'labels'>,
  config: Pick<ActionConfig, 'releaseLabels' | 'noopLabels'>,
): ReleaseType {
  const labelNames = pr.labels.map((label) => label.name)
  const releaseLabelsPresent = labelNames.filter((name) =>
    Object.keys(config.releaseLabels).includes(name),
  )
  const noopLabelsPresent = labelNames.filter((name) =>
    Object.keys(config.noopLabels).includes(name),
  )
  if (releaseLabelsPresent.length === 0 && noopLabelsPresent.length === 0) {
    throw new Error('no release label specified on PR')
  }
  if (releaseLabelsPresent.length > 1) {
    throw new Error(`too many release labels specified on PR: ${releaseLabelsPresent}`)
  }
  if (releaseLabelsPresent.length >= 1 && noopLabelsPresent.length >= 1) {
    throw new Error(
      `too manu labels specified, both release labels and noop labels specified: (${releaseLabelsPresent})  (${noopLabelsPresent}) on PR`,
    )
  }

  return releaseLabelsPresent.length === 1
    ? config.releaseLabels[releaseLabelsPresent[0]]
    : config.noopLabels[noopLabelsPresent[0]]
}

// Extracts the release notes from the PR body.
export function getReleaseNotes(
  pr: Pick<PullRequest, 'body'>,
  config: Pick<
    ActionConfig,
    'releaseNotesPrefixPattern' | 'releaseNotesSuffixPattern' | 'requireReleaseNotes'
  >,
): string {
  let notes: string[] = []

  if (pr.body !== null && pr.body !== '') {
    const lines = pr.body.split(/\r?\n/)
    let withinNotes = config.releaseNotesPrefixPattern === undefined
    let firstLine = 0

    // Default to the entire PR body.
    let lastLine = lines.length

    // If a prefix or suffix has been defined default to none of the PR body.
    if (
      config.releaseNotesPrefixPattern !== undefined ||
      config.releaseNotesSuffixPattern !== undefined
    ) {
      lastLine = 0
    }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]

      if (withinNotes) {
        if (config.releaseNotesSuffixPattern?.test(line)) {
          lastLine = i
          break
        }
      } else if (config.releaseNotesPrefixPattern?.test(line)) {
        // Now that we've seen the prefix, set the lastLine to the end of the message.
        lastLine = lines.length
        firstLine = i + 1
        withinNotes = true
      }
    }

    notes = lines.slice(firstLine, lastLine)
  }

  if (notes.length === 0 && config.requireReleaseNotes) {
    throw new Error('missing release notes')
  }

  return notes.join('\n').trim()
}
