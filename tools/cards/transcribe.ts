// Source Vocal (#48) : transcrit sur le Mac l'audio récupéré par `inbox claim`. Aucun accès base ni réseau.
// ffmpeg (wav 16 kHz mono) puis whisper-cli (Metal, langue détectée), mêmes réglages que transcribe_media.py du second cerveau.
// `execFile` avec un tableau d'arguments, jamais de shell ; tous les chemins viennent de RUN_DIR et de l'id (UUID), jamais
// du nom de fichier de l'utilisateur. Ni la transcription ni la sortie des programmes (issue d'un fichier de l'utilisateur)
// ne sont affichées ou recopiées dans une erreur.
import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { assertRunDir, audioFormat, MIME_EXT, type AudioFormat } from './inbox.ts'

export const WHISPER_MODEL = path.join(os.homedir(), '.local/share/whisper/ggml-large-v3-turbo-q5_0.bin')
export const FFMPEG_TIMEOUT_MS = 5 * 60 * 1000
/** Un fichier de 30 Mo à faible débit peut durer plusieurs heures : large, mais borné. */
export const WHISPER_TIMEOUT_MS = 60 * 60 * 1000
/** Durée décodée au plus : un fichier de 30 Mo à très faible débit donnerait plus d'un Go de wav. */
export const MAX_AUDIO_SECONDS = 3 * 60 * 60
/** whisper-cli écrit aussi le texte sur stdout : marge pour qu'un long audio ne soit pas interrompu. */
const MAX_BUFFER = 64 * 1024 * 1024

const AUDIO_EXTS = [...new Set(Object.entries(MIME_EXT).filter(([mime]) => mime.startsWith('audio/')).map(([, ext]) => ext))]

export function ffmpegArgs(audio: string, wav: string, format: AudioFormat): string[] {
  // Fichier local seulement, démuxeur imposé par la signature : ffmpeg ne devine rien, un fichier piégé ne peut pas faire
  // ouvrir une URL ni passer pour une liste de lecture.
  return ['-nostdin', '-hide_banner', '-loglevel', 'error', '-protocol_whitelist', 'file', '-f', format, '-i', audio, '-t', String(MAX_AUDIO_SECONDS), '-vn', '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', '-y', wav]
}

export function whisperArgs(model: string, wav: string, outBase: string): string[] {
  return ['-m', model, '-f', wav, '-l', 'auto', '-nt', '-np', '-otxt', '-of', outBase]
}

export type Runner = (cmd: string, args: string[], timeoutMs: number) => Promise<void>

/** Exécution réelle, sans shell. Erreur courte et neutre : nom du programme et code de sortie, jamais sa sortie. */
export const execRunner: Runner = (cmd, args, timeoutMs) => new Promise((resolve, reject) => {
  execFile(cmd, args, { timeout: timeoutMs, maxBuffer: MAX_BUFFER, shell: false }, error => {
    if (!error) return resolve()
    const e = error as NodeJS.ErrnoException & { killed?: boolean }
    if (e.code === 'ENOENT') return reject(new Error(`${cmd} introuvable : à installer avec Homebrew (brew install ${cmd === 'ffmpeg' ? 'ffmpeg' : 'whisper-cpp'})`))
    if (e.killed) return reject(new Error(`${cmd} interrompu : délai de ${Math.round(timeoutMs / 60000)} min dépassé`))
    reject(new Error(`${cmd} a échoué (code ${e.code ?? 'inconnu'})`))
  })
})

/** L'audio écrit par `claim` : `<id>.<ext>`, fichier ordinaire (pas de lien). */
async function findAudio(dir: string, id: string): Promise<string> {
  for (const ext of AUDIO_EXTS) {
    const file = path.join(dir, `${id}.${ext}`)
    if ((await fs.lstat(file).catch(() => null))?.isFile()) return file
  }
  throw new Error(`audio introuvable pour ${id} : lancer d'abord inbox claim avec le même dossier`)
}

/** Format lu sur les premiers octets du fichier, pas sur son extension. */
async function readFormat(file: string): Promise<AudioFormat> {
  const handle = await fs.open(file, 'r')
  try {
    const { buffer, bytesRead } = await handle.read(new Uint8Array(16), 0, 16, 0)
    const format = audioFormat(buffer.subarray(0, bytesRead))
    if (!format) throw new Error('contenu audio non reconnu')
    return format
  } finally {
    await handle.close()
  }
}

/** Écrit `<RUN_DIR>/<id>.txt`, sans écraser. Le statut de l'élément ne change pas : en cas d'échec, l'agent lance `inbox fail`. */
export async function transcribe(id: string, runDir: string, run: Runner = execRunner, model = WHISPER_MODEL) {
  const dir = await assertRunDir(runDir)
  const audio = await findAudio(dir, id)
  const format = await readFormat(audio)
  if (!(await fs.stat(model).catch(() => null))?.isFile()) throw new Error(`modèle whisper introuvable : ${model}`)
  const target = path.join(dir, `${id}.txt`)
  if (await fs.lstat(target).catch(() => null)) throw new Error(`transcription déjà présente : ${target}`)
  const wav = path.join(dir, `${id}.16k.wav`)
  const outBase = path.join(dir, `${id}.whisper`)
  try {
    await run('ffmpeg', ffmpegArgs(audio, wav, format), FFMPEG_TIMEOUT_MS)
    await run('whisper-cli', whisperArgs(model, wav, outBase), WHISPER_TIMEOUT_MS)
    const text = (await fs.readFile(`${outBase}.txt`, 'utf8')).trim()
    if (!text) throw new Error('transcription vide : aucune parole détectée ?')
    await fs.writeFile(target, `${text}\n`, { flag: 'wx', mode: 0o600 })
    return { id, path: target, chars: Array.from(text).length }
  } finally {
    await fs.rm(wav, { force: true })
    await fs.rm(`${outBase}.txt`, { force: true })
  }
}
