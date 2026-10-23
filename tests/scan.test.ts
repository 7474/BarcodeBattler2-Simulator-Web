import test from 'node:test'
import assert from 'node:assert/strict'
import { cameraErrorMessage, interpretScan } from '../src/scan.ts'

function withCheck(payload: string) {
  let sum = 0
  for (let i = payload.length - 1, weight = 3; i >= 0; i--, weight = 4 - weight) sum += Number(payload[i]) * weight
  return payload + ((10 - sum % 10) % 10)
}

test('camera text is accepted only as checksum-valid JAN/EAN', () => {
  assert.deepEqual(interpretScan('4901234567894'), { ok: true, code: '4901234567894' })
  assert.deepEqual(interpretScan(' 4901-2345-67894\n'), { ok: true, code: '4901234567894' })
  assert.deepEqual(interpretScan('４９０１２３４５６７８９４'), { ok: true, code: '4901234567894' })
  assert.deepEqual(interpretScan('96385074'), { ok: true, code: '96385074' })
  assert.deepEqual(interpretScan('JAN 4901234567894'), { ok: true, code: '4901234567894' })
  assert.deepEqual(interpretScan('4901234567890'), { ok: false, reason: 'checksum' })
  assert.deepEqual(interpretScan('12345'), { ok: false, reason: 'ignore' })
  assert.deepEqual(interpretScan('https://example.test'), { ok: false, reason: 'ignore' })
  assert.deepEqual(interpretScan(''), { ok: false, reason: 'ignore' })
})

test('12-digit UPC-A and GTIN-14 gain a JAN/EAN-13 form', () => {
  const upc = withCheck('03600029145')
  assert.equal(upc.length, 12)
  assert.deepEqual(interpretScan(upc), { ok: true, code: `0${upc}` })
  assert.deepEqual(interpretScan(`0${upc}`), { ok: true, code: `0${upc}` })
  const gtin = `0${withCheck('490123456789')}`
  assert.equal(gtin.length, 14)
  assert.deepEqual(interpretScan(gtin), { ok: true, code: gtin.slice(1) })
  assert.deepEqual(interpretScan(withCheck('12345678901').slice(0, 11) + '0'), { ok: false, reason: 'checksum' })
})

test('camera failures explain the next action in Japanese', () => {
  assert.match(cameraErrorMessage(new DOMException('nope', 'NotAllowedError')), /拒否/)
  assert.match(cameraErrorMessage(new DOMException('nope', 'NotFoundError')), /見つかりません/)
  assert.match(cameraErrorMessage(new DOMException('nope', 'NotReadableError')), /使用中/)
  assert.match(cameraErrorMessage(new DOMException('nope', 'SecurityError')), /HTTPS/)
  assert.match(cameraErrorMessage(new Error('カメラはHTTPSかlocalhostでのみ使えます。')), /HTTPS/)
  assert.match(cameraErrorMessage(new Error('boom')), /開始できません/)
})
