import test from 'node:test'
import assert from 'node:assert/strict'
import { decodeBarcode } from '../src/game.ts'
import { decodeRecord, encodeRecord, type LocalRecord } from '../src/permalink.ts'

const record = (): LocalRecord => ({
  v: 1, title: 'C0 フリーバトル',
  left: { fighter: { ...decodeBarcode('4901234567894'), maxHp: 48700 }, barcode: '4901234567894', secondBarcode: null },
  right: { fighter: decodeBarcode('96385074'), barcode: '96385074', secondBarcode: null },
  lines: ['守護星 2', '1P 攻撃 5200', '1P CRITICAL', '2P MISS'],
  finalHp: [48700, 3600], winner: 'left', at: 1792790438,
})

test('local battle records round-trip through a URL-safe fragment', async () => {
  const data = await encodeRecord(record())
  assert.match(data, /^[A-Za-z0-9_-]+$/)
  const decoded = await decodeRecord(data)
  assert.deepEqual(decoded.lines, record().lines)
  assert.deepEqual(decoded.finalHp, [48700, 3600])
  assert.equal(decoded.left.fighter.name, record().left.fighter.name)
  assert.equal(decoded.right.barcode, '96385074')
})

test('long battles stay compact', async () => {
  const long = record()
  long.lines = ['守護星 1', ...Array.from({ length: 2000 }, (_, i) => `${i % 2 + 1}P 攻撃 ${100 * (i % 30)}`)]
  const data = await encodeRecord(long)
  assert.ok(data.length < 12000, `encoded length ${data.length}`)
  assert.equal((await decodeRecord(data)).lines.length, 2001)
})

test('tampered or malformed records are rejected', async () => {
  const encode = async (value: unknown) => {
    const json = new TextEncoder().encode(JSON.stringify(value))
    const stream = new Blob([json]).stream().pipeThrough(new CompressionStream('deflate-raw'))
    const bytes = new Uint8Array(await new Response(stream).arrayBuffer())
    return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  }
  await assert.rejects(decodeRecord('not base64!'))
  await assert.rejects(decodeRecord(await encode({ ...record(), v: 2 })), /version/)
  await assert.rejects(decodeRecord(await encode({ ...record(), winner: 'both' })), /winner/)
  await assert.rejects(decodeRecord(await encode({ ...record(), lines: ['<script>\u0000'] })), /text/)
  const bad = record()
  bad.left.fighter = { ...bad.left.fighter, hp: 1e9 }
  await assert.rejects(decodeRecord(await encode(bad)), /value/)
  await assert.rejects(decodeRecord(await encode({ ...record(), left: { ...record().left, barcode: 'javascript:' } })), /barcode/)
})
