/**
 * Permalinks for local (C0/C1/C2) battles. The record lives entirely in the
 * URL fragment (/replay#<data>), so nothing is stored or sent to the server:
 * JSON → deflate-raw (CompressionStream) → base64url. Decoding validates every
 * field because the fragment is untrusted input.
 */
import type { Fighter } from './game.ts'

export interface SharedSide {
  fighter: Fighter
  barcode: string
  secondBarcode?: string | null
}
export interface LocalRecord {
  v: 1
  title: string
  left: SharedSide
  right: SharedSide
  /** Engine log lines, 1P = left. */
  lines: string[]
  finalHp: [number, number]
  winner: 'left' | 'right'
  /** Unix seconds when the battle finished. */
  at: number
}

const MAX_JSON = 256 * 1024
const MAX_LINES = 4200

async function pipe(bytes: Uint8Array<ArrayBuffer>, stream: CompressionStream | DecompressionStream, limit = Infinity): Promise<Uint8Array> {
  const reader = new Blob([bytes]).stream().pipeThrough(stream).getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > limit) { await reader.cancel(); throw new Error('Record is too large') }
    chunks.push(value)
  }
  const out = new Uint8Array(new ArrayBuffer(size))
  let offset = 0
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.byteLength }
  return out
}

const toBase64Url = (bytes: Uint8Array) => {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
const fromBase64Url = (text: string) => {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) throw new Error('Invalid record encoding')
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(binary, c => c.charCodeAt(0)) as Uint8Array<ArrayBuffer>
}

export async function encodeRecord(record: LocalRecord): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(record))
  return toBase64Url(await pipe(json, new CompressionStream('deflate-raw')))
}

const int = (value: unknown, min: number, max: number) => {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) throw new Error('Invalid record value')
  return value
}
const text = (value: unknown, max: number) => {
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) throw new Error('Invalid record text')
  return value
}
const code = (value: unknown) => {
  if (typeof value !== 'string' || !/^\d{8}$|^\d{13}$/.test(value)) throw new Error('Invalid record barcode')
  return value
}

function fighter(raw: unknown): Fighter {
  if (!raw || typeof raw !== 'object') throw new Error('Invalid record fighter')
  const f = raw as Record<string, unknown>
  const optional = (key: string, min: number, max: number) => f[key] === undefined || f[key] === null ? undefined : int(f[key], min, max)
  return {
    barcode: code(f.barcode), name: text(f.name, 80), kind: 'fighter', reading: f.reading === 'pre' ? 'pre' : 'post',
    hp: int(f.hp, 0, 99900), maxHp: optional('maxHp', 0, 99900), attack: int(f.attack, -19900, 19900), defense: int(f.defense, -19900, 19900),
    speed: int(f.speed, 0, 9), race: int(f.race, 0, 4), job: int(f.job, 0, 9), special: int(f.special, 0, 99),
    special2: optional('special2', 0, 99), race2: optional('race2', 0, 9), union: f.union === true ? true : undefined,
    mp: int(f.mp, 0, 99), pp: int(f.pp, 0, 99),
    attack1: optional('attack1', -19900, 19900), attack2: optional('attack2', -19900, 19900),
    defense1: optional('defense1', -19900, 19900), defense2: optional('defense2', -19900, 19900),
  }
}

function side(raw: unknown): SharedSide {
  if (!raw || typeof raw !== 'object') throw new Error('Invalid record side')
  const s = raw as Record<string, unknown>
  return { fighter: fighter(s.fighter), barcode: code(s.barcode), secondBarcode: s.secondBarcode ? code(s.secondBarcode) : null }
}

export async function decodeRecord(data: string): Promise<LocalRecord> {
  if (data.length > 200_000) throw new Error('Record is too large')
  const json = new TextDecoder().decode(await pipe(fromBase64Url(data), new DecompressionStream('deflate-raw'), MAX_JSON))
  const raw = JSON.parse(json) as Record<string, unknown>
  if (raw.v !== 1) throw new Error('Unsupported record version')
  if (!Array.isArray(raw.lines) || raw.lines.length > MAX_LINES) throw new Error('Invalid record log')
  if (!Array.isArray(raw.finalHp) || raw.finalHp.length !== 2) throw new Error('Invalid record HP')
  if (raw.winner !== 'left' && raw.winner !== 'right') throw new Error('Invalid record winner')
  return {
    v: 1, title: text(raw.title, 80), left: side(raw.left), right: side(raw.right),
    lines: raw.lines.map(line => text(line, 60)),
    finalHp: [int(raw.finalHp[0], 0, 99900), int(raw.finalHp[1], 0, 99900)],
    winner: raw.winner, at: int(raw.at, 0, 2 ** 32),
  }
}
