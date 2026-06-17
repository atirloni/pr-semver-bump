import type { getOctokit } from '@actions/github'

export type Mode = 'validate' | 'bump'
export type ReleaseType = 'major' | 'minor' | 'patch' | 'skip'
export type VersionReleaseType = Exclude<ReleaseType, 'skip'>

export interface ActionConfig {
  mode: Mode
  octokit: ReturnType<typeof getOctokit>
  releaseLabels: Record<string, VersionReleaseType>
  noopLabels: Record<string, 'skip'>
  releaseNotesPrefixPattern?: RegExp
  releaseNotesSuffixPattern?: RegExp
  requireReleaseNotes: boolean
  baseBranch: boolean
  v: '' | 'v'
}

export interface PullRequestLabel {
  name: string
}

export interface PullRequest {
  number?: number
  labels: PullRequestLabel[]
  body: string | null
}

export interface GitRefObject {
  type: 'commit' | 'tag'
  sha: string
}
