// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execRunner, ffmpegArgs, FFMPEG_TIMEOUT_MS, transcribe, whisperArgs, WHISPER_MODEL, WHISPER_TIMEOUT_MS, type Runner } from './transcribe.ts'

const ID = '11111111-1111-4111-8111-111111111111'
let dir: string
let model: string

beforeEach(async () => {
  dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'transcribe-test-')))
  model = path.join(dir, 'modele.bin')
  await fs.writeFile(model, 'x')
})
afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }) })

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
  it('ffmpeg : wav 16 kHz mono, fichier local seulement, sans saisie', () => {
    expect(ffmpegArgs('/r/a.m4a', '/r/a.wav')).toEqual([
      '-nostdin', '-hide_banner', '-loglevel', 'error', '-protocol_whitelist', 'file', '-i', '/r/a.m4a', '-vn', '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', '-y', '/r/a.wav',
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
    await fs.writeFile(audio, 'son')
    const { run, calls } = fakeRun()
    const result = await transcribe(ID, dir, run, model)
    expect(result).toEqual({ id: ID, path: path.join(dir, `${ID}.txt`), chars: 'Bonjour tout le monde.'.length })
    expect(await fs.readFile(result.path, 'utf8')).toBe('Bonjour tout le monde.\n')
    expect(calls.map(c => c.cmd)).toEqual(['ffmpeg', 'whisper-cli'])
    expect(calls.map(c => c.timeoutMs)).toEqual([FFMPEG_TIMEOUT_MS, WHISPER_TIMEOUT_MS])
    expect(calls[0].args).toContain(audio)
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

  it('modèle absent : erreur claire', async () => {
    await fs.writeFile(path.join(dir, `${ID}.m4a`), 'son')
    const { run, calls } = fakeRun()
    await expect(transcribe(ID, dir, run, path.join(dir, 'absent.bin'))).rejects.toThrow('modèle whisper introuvable')
    expect(calls).toEqual([])
  })

  it('RUN_DIR hors du dossier temporaire : refusé', async () => {
    const { run } = fakeRun()
    await expect(transcribe(ID, os.homedir(), run, model)).rejects.toThrow('RUN_DIR hors du dossier temporaire')
  })

  it('transcription déjà présente : pas d’écrasement', async () => {
    await fs.writeFile(path.join(dir, `${ID}.m4a`), 'son')
    await fs.writeFile(path.join(dir, `${ID}.txt`), 'ancien')
    const { run, calls } = fakeRun()
    await expect(transcribe(ID, dir, run, model)).rejects.toThrow('transcription déjà présente')
    expect(calls).toEqual([])
    expect(await fs.readFile(path.join(dir, `${ID}.txt`), 'utf8')).toBe('ancien')
  })

  it('transcription vide : erreur, aucun .txt, fichiers intermédiaires supprimés', async () => {
    await fs.writeFile(path.join(dir, `${ID}.m4a`), 'son')
    const { run } = fakeRun('  \n')
    await expect(transcribe(ID, dir, run, model)).rejects.toThrow('transcription vide')
    expect((await fs.readdir(dir)).sort()).toEqual([`${ID}.m4a`, 'modele.bin'].sort())
  })

  it('échec d’un programme : l’erreur remonte, le wav est supprimé', async () => {
    await fs.writeFile(path.join(dir, `${ID}.m4a`), 'son')
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

  it('délai dépassé : processus interrompu, message clair', async () => {
    await expect(execRunner('/bin/sleep', ['5'], 50)).rejects.toThrow('interrompu')
  })

  it('n’utilise jamais de shell : les arguments restent littéraux', async () => {
    const out = path.join(dir, 'pas-cree')
    await execRunner('/bin/echo', [`; touch ${out}`], 1000)
    await expect(fs.stat(out)).rejects.toThrow()
  })
})
