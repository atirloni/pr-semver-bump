import * as github from '@actions/github'
import type { ActionConfig, PullRequest, ReleaseType } from './types'

/** Matches the default merge-commit subject GitHub generates, e.g. `Merge pull request #42 from ...`. */
const MERGE_COMMIT_PR_PATTERN = /Merge pull request #(\d+) from/

/** Matches the `(#42)` suffix GitHub appends to squash-merge commit titles. */
const SQUASH_COMMIT_PR_PATTERN = /\(#(\d+)\)/

/**
 * Extracts a PR number from a commit message.
 *
 * @returns The PR number as a string, or `null` if the message references none.
 */
export function extractPRNumber(commitMsg: string): string | null {
  const mergeMatch = commitMsg.match(MERGE_COMMIT_PR_PATTERN)
  if (mergeMatch) {
    return mergeMatch[1].trim()
  }

  // Squash merges drop the "Merge pull request" subject and instead append "(#<num>)" to the title.
  const squashMatch = commitMsg.match(SQUASH_COMMIT_PR_PATTERN)
  if (squashMatch) {
    return squashMatch[1].trim()
  }

  return null
}

/**
 * Looks up the merged PR that a commit SHA belongs to via GitHub search.
 *
 * Used as a fallback for rebase merges, which leave no PR reference in the
 * commit message.
 *
 * @returns The matching merged PR, or `null` when the commit belongs to no PR
 * (e.g. a direct push). Returning `null` lets the caller skip gracefully
 * instead of failing the run.
 * @throws If the search API request itself fails.
 */
export async function searchPRByCommit(
  commitSHA: string | undefined,
  config: Pick<ActionConfig, 'octokit'>,
): Promise<PullRequest | null> {
  try {
    const query = `type:pr is:merged ${commitSHA}`
    const { data } = await config.octokit.rest.search.issuesAndPullRequests({ q: query })

    // No merged PR matches this commit; let the caller decide how to handle it.
    if (data.total_count < 1) {
      return null
    }

    // A merged commit SHA maps to a single PR, so take the first match.
    return data.items[0] as PullRequest
  } catch (error) {
    throw new Error(`Failed to find PR by commit SHA ${commitSHA}: ${(error as Error).message}`)
  }
}

/**
 * Fetches the full details of a pull request by number.
 *
 * @throws If the PR can't be fetched (e.g. it doesn't exist or access is denied).
 */
export async function fetchPR(
  num: number | string,
  config: Pick<ActionConfig, 'octokit'>,
): Promise<PullRequest> {
  try {
    const { data } = await config.octokit.rest.pulls.get({
      ...github.context.repo,
      pull_number: Number(num),
    })

    return data as PullRequest
  } catch (error) {
    throw new Error(`failed to fetch data for PR #${num}: ${(error as Error).message}`)
  }
}

/**
 * Determines the release type from a PR's labels.
 *
 * Exactly one release label (or one no-op label) must be present.
 *
 * @throws If no recognized label is present, or if conflicting labels are.
 */
export function getReleaseType(
  pr: Pick<PullRequest, 'labels'>,
  config: Pick<ActionConfig, 'releaseLabels' | 'noopLabels'>,
): ReleaseType {
  const labelNames = pr.labels.map((label) => label.name)
  const releaseLabelsPresent = labelNames.filter((name) =>
    Object.hasOwn(config.releaseLabels, name),
  )
  const noopLabelsPresent = labelNames.filter((name) => Object.hasOwn(config.noopLabels, name))

  if (releaseLabelsPresent.length === 0 && noopLabelsPresent.length === 0) {
    throw new Error('no release label specified on PR')
  }
  if (releaseLabelsPresent.length > 1) {
    throw new Error(`too many release labels specified on PR: ${releaseLabelsPresent}`)
  }
  if (releaseLabelsPresent.length >= 1 && noopLabelsPresent.length >= 1) {
    throw new Error(
      `too many labels specified, both release labels and noop labels specified: (${releaseLabelsPresent})  (${noopLabelsPresent}) on PR`,
    )
  }

  return releaseLabelsPresent.length === 1
    ? config.releaseLabels[releaseLabelsPresent[0]]
    : config.noopLabels[noopLabelsPresent[0]]
}

/**
 * Resolves the `[start, end)` line range of the PR body that holds the release notes.
 *
 * With no prefix or suffix configured, the entire body qualifies. A prefix
 * moves the start to the line *after* its first match; a suffix moves the end
 * to its first match once we're already inside the notes region.
 */
function findReleaseNotesBounds(
  lines: string[],
  prefixPattern: RegExp | undefined,
  suffixPattern: RegExp | undefined,
): { start: number; end: number } {
  // Without a prefix, the notes begin at the very first line.
  let withinNotes = prefixPattern === undefined
  let start = 0
  // With no boundaries the notes span the whole body; with either boundary
  // configured, include nothing until a match reveals where they begin/end.
  let end = prefixPattern === undefined && suffixPattern === undefined ? lines.length : 0

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    if (withinNotes) {
      if (suffixPattern?.test(line)) {
        end = i
        break
      }
    } else if (prefixPattern?.test(line)) {
      // Notes start on the next line and run to the end, unless a later suffix trims them.
      start = i + 1
      end = lines.length
      withinNotes = true
    }
  }

  return { start, end }
}

/**
 * Extracts the release notes from a PR body, optionally bounded by the
 * configured prefix/suffix patterns, and trims surrounding whitespace.
 *
 * @throws If notes are required but the resolved range is empty.
 */
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
    const { start, end } = findReleaseNotesBounds(
      lines,
      config.releaseNotesPrefixPattern,
      config.releaseNotesSuffixPattern,
    )
    notes = lines.slice(start, end)
  }

  if (notes.length === 0 && config.requireReleaseNotes) {
    throw new Error('missing release notes')
  }

  return notes.join('\n').trim()
}
