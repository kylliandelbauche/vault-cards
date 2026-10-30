// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execRunner, ffmpegArgs, FFMPEG_TIMEOUT_MS, MAX_AUDIO_SECONDS, transcribe, whisperArgs, WHISPER_MODEL, WHISPER_TIMEOUT_MS, type Runner } from './transcribe.ts'

const ID = '11111111-1111-4111-8111-111111111111'
let dir: string
let model: string

beforeEach(async () => {
  dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'transcribe-test-')))
  model = path.join(dir, 'modele.bin')
  await fs.writeFile(model, 'x')
})
afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }) })

const HEADERS: Record<string, { bytes: number[]; format: string }> = {
  m4a: { bytes: [0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20], format: 'mov' },
  webm: { bytes: [0x1a, 0x45, 0xdf, 0xa3, 1, 2], format: 'matroska' },
  wav: { bytes: [0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x41, 0x56, 0x45], format: 'wav' },
  mp3: { bytes: [0x49, 0x44, 0x33, 4, 0], format: 'mp3' },
}
const writeAudio = (ext: string) => fs.writeFile(path.join(dir, `${ID}.${ext}`), new Uint8Array(HEADERS[ext].bytes))

/** Exécution simulée : ffmpeg crée le wav, whisper-cli crée la sortie texte. */
function fakeRun(text = '  Bonjour tout le monde.\n') {
  const calls: { cmd: string; args: string[]; timeoutMs: number }[] = []
  const run: Runner = async (cmd, args, timeoutMs) => {
    calls.push({ cmd, args, timeoutMs })
    if (cmd === 'ffmpeg') await fs.writeFile(args[args.length - 1], 'wav')
    else await fs.writeFile(`${args[args.indexOf('-of') + 1]}.txt`, text)
  }
  return { run, calls }
}

describe('arguments', () => {
  it('ffmpeg : wav 16 kHz mono, fichier local seulement, format imposé, durée bornée, sans saisie', () => {
    expect(ffmpegArgs('/r/a.m4a', '/r/a.wav', 'mov')).toEqual([
      '-nostdin', '-hide_banner', '-loglevel', 'error', '-protocol_whitelist', 'file', '-f', 'mov', '-i', '/r/a.m4a', '-t', String(MAX_AUDIO_SECONDS), '-vn', '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', '-y', '/r/a.wav',
    ])
  })

  it('whisper-cli : modèle, langue détectée, sortie texte', () => {
    expect(whisperArgs('/m.bin', '/r/a.wav', '/r/out')).toEqual(['-m', '/m.bin', '-f', '/r/a.wav', '-l', 'auto', '-nt', '-np', '-otxt', '-of', '/r/out'])
    expect(WHISPER_MODEL.endsWith('.local/share/whisper/ggml-large-v3-turbo-q5_0.bin')).toBe(true)
  })
})

describe('transcribe', () => {
  it.each(['m4a', 'webm', 'wav', 'mp3'])('audio .%s : écrit <id>.txt, chemins nommés par l’id, délais imposés, fichiers intermédiaires supprimés', async ext => {
    const audio = path.join(dir, `${ID}.${ext}`)
    await writeAudio(ext)
    const { run, calls } = fakeRun()
    const result = await transcribe(ID, dir, run, model)
    expect(result).toEqual({ id: ID, path: path.join(dir, `${ID}.txt`), chars: 'Bonjour tout le monde.'.length })
    expect(await fs.readFile(result.path, 'utf8')).toBe('Bonjour tout le monde.\n')
    expect(calls.map(c => c.cmd)).toEqual(['ffmpeg', 'whisper-cli'])
    expect(calls.map(c => c.timeoutMs)).toEqual([FFMPEG_TIMEOUT_MS, WHISPER_TIMEOUT_MS])
    expect(calls[0].args).toContain(audio)
    expect(calls[0].args[calls[0].args.indexOf('-f') + 1]).toBe(HEADERS[ext].format)
    expect(calls[1].args).toContain(model)
    for (const a of [...calls[0].args, ...calls[1].args]) if (a.startsWith('/')) expect(path.dirname(a) === dir).toBe(true)
    expect((await fs.readdir(dir)).sort()).toEqual([`${ID}.${ext}`, `${ID}.txt`, 'modele.bin'].sort())
    expect((await fs.stat(result.path)).mode & 0o777).toBe(0o600)
  })

  it('audio absent : erreur claire, aucun programme lancé', async () => {
    const { run, calls } = fakeRun()
    await expect(transcribe(ID, dir, run, model)).rejects.toThrow('lancer d\'abord inbox claim')
    expect(calls).toEqual([])
  })

  it('lien au lieu d’un fichier : refusé', async () => {
    await fs.symlink('/etc/hosts', path.join(dir, `${ID}.mp3`))
    const { run, calls } = fakeRun()
    await expect(transcribe(ID, dir, run, model)).rejects.toThrow('audio introuvable')
    expect(calls).toEqual([])
  })

  it('le format vient des octets, pas de l’extension ; contenu inconnu : aucun programme lancé', async () => {
    await fs.writeFile(path.join(dir, `${ID}.m4a`), new Uint8Array(HEADERS.webm.bytes))
    const a = fakeRun()
    await transcribe(ID, dir, a.run, model)
    expect(a.calls[0].args[a.calls[0].args.indexOf('-f') + 1]).toBe('matroska')
    await fs.rm(path.join(dir, `${ID}.txt`))
    await fs.writeFile(path.join(dir, `${ID}.m4a`), '#EXTM3U\nhttp://exemple.test/x')
    const b = fakeRun()
    await expect(transcribe(ID, dir, b.run, model)).rejects.toThrow('contenu audio non reconnu')
    expect(b.calls).toEqual([])
  })

  it('modèle absent : erreur claire', async () => {
    await writeAudio('m4a')
    const { run, calls } = fakeRun()
    await expect(transcribe(ID, dir, run, path.join(dir, 'absent.bin'))).rejects.toThrow('modèle whisper introuvable')
    expect(calls).toEqual([])
  })

  it('RUN_DIR hors du dossier temporaire : refusé', async () => {
    const { run } = fakeRun()
    await expect(transcribe(ID, os.homedir(), run, model)).rejects.toThrow('RUN_DIR hors du dossier temporaire')
  })

  it('transcription déjà présente : pas d’écrasement', async () => {
    await writeAudio('m4a')
    await fs.writeFile(path.join(dir, `${ID}.txt`), 'ancien')
    const { run, calls } = fakeRun()
    await expect(transcribe(ID, dir, run, model)).rejects.toThrow('transcription déjà présente')
    expect(calls).toEqual([])
    expect(await fs.readFile(path.join(dir, `${ID}.txt`), 'utf8')).toBe('ancien')
  })

  it('transcription vide : erreur, aucun .txt, fichiers intermédiaires supprimés', async () => {
    await writeAudio('m4a')
    const { run } = fakeRun('  \n')
    await expect(transcribe(ID, dir, run, model)).rejects.toThrow('transcription vide')
    expect((await fs.readdir(dir)).sort()).toEqual([`${ID}.m4a`, 'modele.bin'].sort())
  })

  it('échec d’un programme : l’erreur remonte, le wav est supprimé', async () => {
    await writeAudio('m4a')
    const run: Runner = async (cmd, args) => {
      if (cmd === 'ffmpeg') await fs.writeFile(args[args.length - 1], 'wav')
      else throw new Error('whisper-cli a échoué')
    }
    await expect(transcribe(ID, dir, run, model)).rejects.toThrow('whisper-cli a échoué')
    expect((await fs.readdir(dir)).sort()).toEqual([`${ID}.m4a`, 'modele.bin'].sort())
  })
})

describe('execRunner', () => {
  it('programme introuvable : message clair avec l’installation', async () => {
    await expect(execRunner('programme-absent-xyz', [], 1000)).rejects.toThrow('programme-absent-xyz introuvable')
  })

  it('échec : nom du programme et code seulement, jamais sa sortie', async () => {
    const error = await execRunner('/bin/sh', ['-c', 'echo contenu-du-fichier >&2; echo contenu-du-fichier; exit 3'], 5000).catch((e: Error) => e)
    expect((error as Error).message).toBe('/bin/sh a échoué (code 3)')
  })

  it('délai dépassé : processus interrompu, message clair', async () => {
    await expect(execRunner('/bin/sleep', ['5'], 50)).rejects.toThrow('interrompu')
  })

  it('n’utilise jamais de shell : les arguments restent littéraux', async () => {
    const out = path.join(dir, 'pas-cree')
    await execRunner('/bin/echo', [`; touch ${out}`], 1000)
    await expect(fs.stat(out)).rejects.toThrow()
  })
})
