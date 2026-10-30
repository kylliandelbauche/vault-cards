import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App as KApp } from 'konsta/react'
import { VaultDB } from '../../lib/db'
import type { InboxDeps, InboxItem } from '../../lib/inbox'
import { FakeMediaRecorder, fakeStream, setMediaDevices } from '../../lib/recorder.fixture'
import { SignedInApp } from '../home/SignedInApp'

const item = (over: Partial<InboxItem> = {}): InboxItem => ({
  id: 'i1', kind: 'file', filename: 'Vocal du 19-10.m4a', mime: 'audio/mp4', size: 10, status: 'pending', error: null,
  created_at: '2026-10-19T10:00:00Z', processed_at: null, ...over,
})

let db: VaultDB
beforeEach(() => {
  window.history.replaceState(null, '')
  db = new VaultDB(`voice-${crypto.randomUUID()}`)
  FakeMediaRecorder.reset()
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder)
})
afterEach(async () => {
  cleanup()
  vi.unstubAllGlobals()
  setMediaDevices(undefined)
  db.close()
  await db.delete()
})

async function openVoice({ online = true, getUserMedia }: { online?: boolean; getUserMedia?: () => Promise<MediaStream> } = {}) {
  const { track, stream } = fakeStream()
  setMediaDevices(getUserMedia ?? (() => Promise.resolve(stream)))
  const rpc = vi.fn().mockResolvedValue({ data: item(), error: null })
  const upload = vi.fn().mockResolvedValue({ data: {}, error: null })
  const client = {
    rpc,
    auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: 'u1' } } } }) },
    storage: { from: () => ({ upload }) },
    from: () => ({ select: () => ({ order: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }) }) }),
  }
  const inbox: InboxDeps = { client: client as unknown as InboxDeps['client'], online: () => online, uuid: () => 'i1' }
  const runSync = vi.fn().mockResolvedValue({ pushed: 0, pulledCards: 0, pulledReviews: 0 })
  render(<KApp theme="ios"><SignedInApp db={db} runSync={runSync} now={() => new Date('2026-10-19T10:00:00Z')} onSignOut={vi.fn()} inbox={inbox} /></KApp>)
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: 'Vocal' }))
  await screen.findByRole('heading', { level: 1, name: 'Vocal' })
  return { track, rpc, upload, user }
}

const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement
const send = () => button('Créer les brouillons')
const importButton = () => button('Importer un fichier audio')
const fileInput = () => screen.getByLabelText('Choisir un fichier audio') as HTMLInputElement
const title = () => screen.getByRole('heading', { level: 1 }).textContent

async function record(user: ReturnType<typeof userEvent.setup>) {
  await user.click(button('Démarrer l’enregistrement'))
  await screen.findByText('Enregistrement… touche pour arrêter')
}

describe('Source · Vocal (#48) : enregistrer', () => {
  it('écran vide : chrono à zéro, envoi désactivé, ✕ ferme sans confirmation', async () => {
    const { user } = await openVoice()
    expect(screen.getByRole('timer').textContent).toBe('0:00')
    expect(send().disabled).toBe(true)
    expect(importButton().disabled).toBe(false)
    await user.click(button('Fermer'))
    expect(await screen.findByRole('heading', { name: 'Nouvelles cartes' })).toBeTruthy()
  })

  it('démarrer, arrêter, envoyer : pistes libérées, type normalisé, écran Brouillons', async () => {
    const { user, track, upload, rpc } = await openVoice()
    await record(user)
    expect(send().disabled).toBe(true)
    expect(importButton().disabled).toBe(true)
    expect(track.stopped).toBe(false)
    FakeMediaRecorder.instances[0].mimeType = 'audio/mp4;codecs=mp4a.40.2'
    await user.click(button('Arrêter l’enregistrement'))
    expect(track.stopped).toBe(true)
    await screen.findByText('Enregistrement prêt à envoyer')
    expect(screen.queryByRole('button', { name: 'Démarrer l’enregistrement' })).toBeNull()
    await user.click(send())
    const [path, body, options] = upload.mock.calls[0] as [string, Blob, { contentType: string; upsert: boolean }]
    expect(path).toBe('u1/i1')
    expect(body.type).toBe('audio/mp4')
    expect(options).toEqual({ contentType: 'audio/mp4', upsert: false })
    expect(rpc).toHaveBeenCalledWith('create_inbox_item', { p_id: 'i1', p_kind: 'file', p_filename: expect.stringMatching(/^Vocal du \d\d-\d\d\.m4a$/) })
    expect(await screen.findByText(/^Depuis « Vocal du 19-10\.m4a »/)).toBeTruthy()
  })

  it('format webm avec codecs (Chrome) : envoyé en audio/webm, sans paramètre', async () => {
    FakeMediaRecorder.reset(['audio/webm;codecs=opus'])
    const { user, upload } = await openVoice()
    await record(user)
    await user.click(button('Arrêter l’enregistrement'))
    await screen.findByText('Enregistrement prêt à envoyer')
    await user.click(send())
    await waitFor(() => expect(upload).toHaveBeenCalled())
    expect((upload.mock.calls[0][1] as Blob).type).toBe('audio/webm')
  })

  it('« Recommencer » demande confirmation, puis revient à l’écran vide', async () => {
    const { user } = await openVoice()
    await record(user)
    await user.click(button('Arrêter l’enregistrement'))
    await user.click(await screen.findByRole('button', { name: 'Recommencer' }))
    await user.click(screen.getByRole('button', { name: 'Continuer à modifier' }))
    expect(send().disabled).toBe(false)
    await user.click(button('Recommencer'))
    await user.click(screen.getByRole('button', { name: 'Ignorer les modifications' }))
    expect(await screen.findByText('Touche pour enregistrer')).toBeTruthy()
    expect(send().disabled).toBe(true)
  })

  it('hors ligne : message clair, l’enregistrement reste prêt à renvoyer', async () => {
    const { user, upload } = await openVoice({ online: false })
    await record(user)
    await user.click(button('Arrêter l’enregistrement'))
    await screen.findByText('Enregistrement prêt à envoyer')
    await user.click(send())
    expect((await screen.findByRole('alert')).textContent).toMatch(/Pas de connexion/)
    expect(upload).not.toHaveBeenCalled()
    expect(send().disabled).toBe(false)
  })
})

describe('Source · Vocal : micro indisponible, l’import reste possible', () => {
  it.each([
    ['NotAllowedError', /^Micro refusé/],
    ['NotFoundError', /^Aucun micro détecté/],
  ])('%s : message en français', async (name, message) => {
    const { user } = await openVoice({ getUserMedia: () => Promise.reject(new DOMException('x', name)) })
    await user.click(button('Démarrer l’enregistrement'))
    expect((await screen.findByRole('alert')).textContent).toMatch(message)
    expect(importButton().disabled).toBe(false)
    expect(send().disabled).toBe(true)
  })

  it('navigateur non compatible : pas de bouton d’enregistrement, message, import possible', async () => {
    FakeMediaRecorder.reset([])
    await openVoice()
    expect(screen.queryByRole('button', { name: 'Démarrer l’enregistrement' })).toBeNull()
    expect(screen.getByRole('alert').textContent).toMatch(/ne permet pas d’enregistrer/)
    expect(importButton().disabled).toBe(false)
  })
})

describe('Source · Vocal : importer', () => {
  it('fichier valide : nom affiché, envoi avec le type de l’extension', async () => {
    const { user, upload, rpc } = await openVoice()
    await user.upload(fileInput(), new File(['son'], 'Cours de chimie.m4a', { type: 'audio/x-m4a' }))
    expect(await screen.findByText('Cours de chimie.m4a')).toBeTruthy()
    await user.click(send())
    await waitFor(() => expect(upload).toHaveBeenCalled())
    expect((upload.mock.calls[0][1] as Blob).type).toBe('audio/mp4')
    expect(rpc).toHaveBeenCalledWith('create_inbox_item', { p_id: 'i1', p_kind: 'file', p_filename: 'Cours de chimie.m4a' })
  })

  it('fichier invalide : refusé en français, rien en attente', async () => {
    const user0 = userEvent.setup({ applyAccept: false })
    await openVoice()
    await user0.upload(fileInput(), new File(['x'], 'photo.png', { type: 'image/png' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/^Format non pris en charge/)
    expect(send().disabled).toBe(true)
  })

  it('« Retirer le fichier » demande confirmation, puis l’enregistrement redevient possible', async () => {
    const { user } = await openVoice()
    await user.upload(fileInput(), new File(['son'], 'note.mp3', { type: 'audio/mpeg' }))
    await user.click(await screen.findByRole('button', { name: 'Retirer le fichier' }))
    await user.click(screen.getByRole('button', { name: 'Ignorer les modifications' }))
    expect(await screen.findByRole('button', { name: 'Démarrer l’enregistrement' })).toBeTruthy()
    expect(send().disabled).toBe(true)
  })
})

describe('Source · Vocal : garde de retour (#88)', () => {
  it('✕ pendant l’enregistrement : confirmation ; « Continuer » poursuit, « Ignorer » libère le micro et ferme', async () => {
    const { user, track } = await openVoice()
    await record(user)
    await user.click(button('Fermer'))
    await user.click(screen.getByRole('button', { name: 'Continuer à modifier' }))
    expect(track.stopped).toBe(false)
    expect(FakeMediaRecorder.instances[0].state).toBe('recording')
    await user.click(button('Fermer'))
    await user.click(screen.getByRole('button', { name: 'Ignorer les modifications' }))
    expect(await screen.findByRole('heading', { name: 'Nouvelles cartes' })).toBeTruthy()
    expect(track.stopped).toBe(true)
    expect(FakeMediaRecorder.instances[0].state).toBe('inactive')
  })

  it('retour du navigateur avec un enregistrement en attente : même confirmation, l’écran reste', async () => {
    const { user } = await openVoice()
    await record(user)
    await user.click(button('Arrêter l’enregistrement'))
    await screen.findByText('Enregistrement prêt à envoyer')
    act(() => { window.history.back() })
    expect(await screen.findByRole('button', { name: 'Ignorer les modifications' })).toBeTruthy()
    expect(title()).toBe('Vocal')
  })

  it('retour du navigateur avec un fichier importé : même confirmation', async () => {
    const { user } = await openVoice()
    await user.upload(fileInput(), new File(['son'], 'note.wav', { type: 'audio/wav' }))
    await screen.findByText('note.wav')
    act(() => { window.history.back() })
    expect(await screen.findByRole('button', { name: 'Ignorer les modifications' })).toBeTruthy()
  })

  it('démontage pendant l’enregistrement : micro libéré', async () => {
    const { user, track } = await openVoice()
    await record(user)
    cleanup()
    expect(track.stopped).toBe(true)
  })
})
