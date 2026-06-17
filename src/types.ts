import type { getOctokit } from '@actions/github'

/** The two ways the action can run: gate a PR, or tag a release after merge. */
export type Mode = 'validate' | 'bump'

/** The kind of version bump derived from a PR's labels. `skip` means no release. */
export type ReleaseType = 'major' | 'minor' | 'patch' | 'skip'

/** A release type that actually advances the version (everything but `skip`). */
export type VersionReleaseType = Exclude<ReleaseType, 'skip'>

/** An authenticated Octokit client, as returned by `@actions/github`. */
export type Octokit = ReturnType<typeof getOctokit>

/** Fully resolved and validated action inputs, shared across the modules. */
export interface ActionConfig {
  mode: Mode
  octokit: Octokit
  /** Label name → the version bump it triggers (e.g. `'major release' → 'major'`). */
  releaseLabels: Record<string, VersionReleaseType>
  /** Label name → `'skip'`, for labels that explicitly suppress a release. */
  noopLabels: Record<string, 'skip'>
  /** When set, release notes begin on the line after the first matching line. */
  releaseNotesPrefixPattern?: RegExp
  /** When set, release notes end on the first matching line. */
  releaseNotesSuffixPattern?: RegExp
  requireReleaseNotes: boolean
  /** Restrict the current-version lookup to tags reachable from the base branch. */
  baseBranch: boolean
  /** Tag prefix: `'v'` to produce tags like `v1.2.3`, otherwise `''`. */
  v: '' | 'v'
}

export interface PullRequestLabel {
  name: string
}

/** The subset of a GitHub pull request this action reads. */
export interface PullRequest {
  number?: number
  labels: PullRequestLabel[]
  body: string | null
}

/** The object a git ref points at: either a commit directly or an annotated tag. */
export interface GitRefObject {
  type: 'commit' | 'tag'
  sha: string
}
