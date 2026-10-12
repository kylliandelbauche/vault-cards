import { describe, it, expect } from 'vitest'
import { obsidianUrl } from './obsidian'

describe('obsidianUrl', () => {
  it('ouvre la note dans le coffre Workspace, chemin encodé sans .md', () => {
    expect(obsidianUrl('3-Resources/veille/ia/a b.md'))
      .toBe('obsidian://open?vault=Workspace&file=3-Resources%2Fveille%2Fia%2Fa%20b')
  })
})
