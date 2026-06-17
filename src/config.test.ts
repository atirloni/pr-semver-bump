import { beforeEach, expect, test } from 'vitest'
import { getConfig } from './config'

function clearInputs() {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('INPUT_')) {
      delete process.env[key]
    }
  }
}

function setInput(name: string, value: string) {
  process.env[`INPUT_${name}`] = value
}

beforeEach(() => {
  clearInputs()
})

test('establishes config from minimum required inputs', () => {
  setInput('MODE', 'validate')
  setInput('REPO-TOKEN', 'mockRepoToken')

  const config = getConfig()
  expect(config.mode).toBe('validate')
  expect(config.releaseLabels).toEqual({
    'major release': 'major',
    'minor release': 'minor',
    'patch release': 'patch',
  })
  expect(config.noopLabels).toEqual({})
  expect(config.releaseNotesPrefixPattern).toBeUndefined()
  expect(config.releaseNotesSuffixPattern).toBeUndefined()
  expect(config.requireReleaseNotes).toBe(false)
  expect(config.baseBranch).toBe(false)
  expect(config.v).toBe('')
  expect(config.octokit).toBeDefined()
  expect(config.octokit).not.toBeNull()
})

test('establishes config from complete set of inputs', () => {
  setInput('MODE', 'validate')
  setInput('REPO-TOKEN', 'mockRepoToken')
  setInput('MAJOR-LABEL', 'major-label-name')
  setInput('MINOR-LABEL', 'minor-label-name')
  setInput('PATCH-LABEL', 'patch-label-name')
  setInput('NOOP-LABELS', 'documentation label\nanother-label')
  setInput('REQUIRE-RELEASE-NOTES', 'true')
  setInput('RELEASE-NOTES-PREFIX', 'release-notes-prefix-text')
  setInput('RELEASE-NOTES-SUFFIX', 'release-notes-suffix-text')
  setInput('WITH-V', 'true')
  setInput('BASE-BRANCH', 'true')

  const config = getConfig()
  expect(config.mode).toBe('validate')
  expect(config.releaseLabels).toEqual({
    'major-label-name': 'major',
    'minor-label-name': 'minor',
    'patch-label-name': 'patch',
  })
  expect(config.noopLabels).toEqual({
    'another-label': 'skip',
    'documentation label': 'skip',
  })
  expect(config.releaseNotesPrefixPattern).toEqual(/release-notes-prefix-text/)
  expect(config.releaseNotesSuffixPattern).toEqual(/release-notes-suffix-text/)
  expect(config.requireReleaseNotes).toBe(true)
  expect(config.baseBranch).toBe(true)
  expect(config.v).toBe('v')
  expect(config.octokit).toBeDefined()
  expect(config.octokit).not.toBeNull()
})

test('accepts bump mode', () => {
  setInput('MODE', 'bump')
  setInput('REPO-TOKEN', 'mockRepoToken')

  expect(getConfig().mode).toBe('bump')
})

test('throws when a required input is missing', () => {
  setInput('MODE', '')
  setInput('REPO-TOKEN', 'mockRepoToken')

  expect(getConfig).toThrow('Input required and not supplied: mode')
})

test('errors out when an invalid mode is specified', () => {
  setInput('MODE', 'invalid')
  setInput('REPO-TOKEN', 'mockRepoToken')

  expect(getConfig).toThrow("mode must be either 'validate' or 'bump'")
})
