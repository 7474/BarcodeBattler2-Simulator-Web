import test from 'node:test'
import assert from 'node:assert/strict'
import { campaignEnemy, campaignPassword, createCampaign, nextCampaignBattle, setCampaignEnemy, useCampaignPassword } from '../src/campaign.ts'
import type { Campaign } from '../src/campaign.ts'
import { createBattle, decodeBarcode } from '../src/game.ts'

const heroCode = '0501919000186'
function seeded(seed: number) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 4294967296
  }
}
function strong(state: Campaign): Campaign {
  return { ...state, hero: { ...state.hero, hp: 99900, maxHp: 99900, attack: 19900, defense: 19900, speed: 9, pp: 99, mp: 99 } }
}
function card(payload: string): string {
  let sum = 0
  for (let i = payload.length - 1, weight = 3; i >= 0; i--, weight = 4 - weight) sum += Number(payload[i]) * weight
  return payload + (10 - sum % 10) % 10
}

test('campaign admission uses actual hero decoding and rejects items, dead heroes and invalid modes', () => {
  for (const mode of ['C1', 'C2'] as const) {
    const state = createCampaign(mode, heroCode)
    assert.equal(state.hero.hp, 5000)
    assert.equal(state.hero.attack, 1900)
    assert.equal(state.mode, mode)
    assert.equal(state.stage, 0)
    assert.equal(state.complete, false)
    assert.equal(state.defeated, false)
    assert.throws(() => createCampaign(mode, '0000005990054'), /hero/)
    assert.throws(() => createCampaign(mode, '00000000'), /living/)
    assert.throws(() => createCampaign(mode, '123'), /Invalid/)
  }
  assert.throws(() => createCampaign('C0' as 'C1', heroCode), /mode/)
  assert.throws(() => createCampaign('C1', heroCode, undefined, { magicianBarcode: 'bad' }), /Invalid/)
})

test('C1 authored E1 enemy table uses checksum rotation, world race and enemy job', () => {
  const state = createCampaign('C1', heroCode) // checksum 6 => pointer 2
  assert.deepEqual(state.keys, ['L1-1', 'L3-2', 'L5-3'])
  const first = campaignEnemy(state)
  assert.deepEqual([first.hp, first.attack, first.defense, first.race, first.job, first.mp, first.speed], [3300,900,1200,0,7,10,5])
  assert.equal(first.name, 'E-1 L-1 01')
  const localBoss = campaignEnemy({ ...state, world: 1, enemy: 4 })
  assert.deepEqual([localBoss.hp, localBoss.attack, localBoss.defense, localBoss.race, localBoss.job, localBoss.speed], [7200,1800,2100,1,5,6])
  const hiddenBoss = campaignEnemy({ ...state, world: 5, enemy: 4 })
  assert.deepEqual([hiddenBoss.hp, hiddenBoss.attack, hiddenBoss.defense, hiddenBoss.race], [9100,2300,2700,4])
  assert.throws(() => setCampaignEnemy(state, heroCode), /C1 enemies/)
})

test('C1 incorporates partner checkdigit in enemy generation', () => {
  const partner = card('050191907018')
  const state = createCampaign('C1', heroCode, undefined, { magicianBarcode: partner })
  assert.equal(state.unionCheckdigit, (6 + Number(partner.at(-1))) % 10)
  assert.notEqual(campaignEnemy(state).hp, campaignEnemy(createCampaign('C1', heroCode)).hp)
})

test('all six C1 chapter tables reproduce original first and hidden-boss HP', () => {
  const state = createCampaign('C1', heroCode)
  const firstHp = [33,81,156,249,363,476]
  const lastHp = [91,168,264,381,516,672]
  for (let chapter = 0; chapter < 6; chapter++) {
    assert.equal(campaignEnemy({ ...state, chapter }).hp, firstHp[chapter] * 100)
    assert.equal(campaignEnemy({ ...state, chapter, world: 5, enemy: 4 }).hp, lastHp[chapter] * 100)
  }
})

test('C1 battles persist health, grant authored growth, collect keys, and do not mutate input', () => {
  const state = strong(createCampaign('C1', heroCode))
  state.hero.hp = 5000
  state.hero.maxHp = 5000
  state.hero.defense = 10000
  const before = structuredClone(state)
  const { state: next, result } = nextCampaignBattle(state, seeded(1))
  assert.equal(result.winner, 'left')
  assert.equal(next.stage, 1)
  assert.equal(next.enemy, 1)
  assert.equal(next.world, 0)
  assert.equal(next.hero.hp, result.leftHp)
  assert.equal(next.keys.length, 2)
  assert.deepEqual(state, before)
  assert.notEqual(campaignEnemy(next).name, campaignEnemy(state).name)
})

test('C1 local boss rewards HP and both stats, then advances to next world', () => {
  const state = strong(createCampaign('C1', heroCode))
  state.enemy = 4
  state.hero.attack = 15000
  state.hero.defense = 15000
  state.hero.hp = 50000
  const { state: next, result } = nextCampaignBattle(state, seeded(2))
  assert.equal(result.winner, 'left')
  assert.equal(next.hero.hp, Math.min(99900, result.leftHp + 2100))
  assert.equal(next.hero.attack, 15100)
  assert.equal(next.hero.defense, 15100)
  assert.equal(next.world, 1)
  assert.equal(next.enemy, 0)
})

test('C1 sweeps 30 actual enemies per chapter, unlocks LH with keys, and ends after E4', () => {
  let state = createCampaign('C1', heroCode)
  const rng = seeded(3)
  for (let count = 0; count < 120; count++) {
    if (state.world === 5) assert.equal(state.keys.length, 0)
    const next = nextCampaignBattle(strong(state), rng)
    assert.equal(next.result.winner, 'left', `battle ${count}`)
    state = next.state
    assert.equal(state.stage, count + 1)
    assert.equal(state.complete, count === 119)
    if (count === 29) {
      assert.equal(state.chapter, 1)
      assert.equal(state.world, 0)
      assert.equal(state.hero.hp, 11500)
      assert.equal(state.hero.attack, 4100)
      assert.equal(state.hero.defense, 3700)
    }
  }
  assert.equal(state.chapter, 3)
  assert.equal(state.enemyName, 'CLEAR')
  assert.throws(() => campaignEnemy(state), /finished/)
  assert.throws(() => nextCampaignBattle(state), /finished/)
})

test('C2 uses actual scanned enemies without hero scaling or invented completion', () => {
  const start = createCampaign('C2', heroCode)
  assert.equal(campaignEnemy(start).barcode, '0401207336501')
  assert.equal(campaignEnemy(start).name, 'ラーメン活武')
  const scanned = setCampaignEnemy(start, '4901234567894')
  assert.equal(campaignEnemy(scanned).hp, decodeBarcode('4901234567894').hp)
  assert.equal(scanned.stage, 0)
  assert.equal(start.enemyBarcode, '0401207336501')
  assert.throws(() => setCampaignEnemy(start, '0000005990054'), /living fighter/)
  const { state, result } = nextCampaignBattle(strong(start), seeded(4))
  assert.equal(result.winner, 'left')
  assert.equal(state.stage, 1)
  assert.equal(state.complete, false)
  assert.equal(state.hero.hp, result.leftHp)
  assert.equal(state.enemyBarcode, start.enemyBarcode)
})

test('C2 original reward specials modify HP/ST/DF and enforce caps', () => {
  for (const [special, hp, attack, defense] of [[65,100,0,0],[69,1000,0,0],[70,0,200,0],[74,0,1000,0],[75,0,0,200],[79,0,0,1000]]) {
    let state = strong(createCampaign('C2', heroCode))
    state.hero.hp = 50000
    state.hero.attack = 15000
    state.hero.defense = 15000
    const code = card(`0010101000${special}`)
    state = setCampaignEnemy(state, code)
    const { state: next, result } = nextCampaignBattle(state, seeded(5))
    assert.equal(result.winner, 'left')
    assert.equal(next.hero.hp, result.leftHp + hp)
    assert.equal(next.hero.attack, 15000 + attack)
    assert.equal(next.hero.defense, 15000 + defense)
    assert.ok(next.hero.mp <= 99 && next.hero.pp <= 99)
  }
})

test('loss ends both campaigns without advancing or granting victory rewards', () => {
  for (const mode of ['C1', 'C2'] as const) {
    const state = createCampaign(mode, heroCode)
    state.hero = { ...state.hero, hp: 100, attack: 0, defense: 0, speed: 0, pp: 0, mp: 0 }
    const { state: next, result } = nextCampaignBattle(state, seeded(6))
    assert.equal(result.winner, 'right')
    assert.equal(next.defeated, true)
    assert.equal(next.stage, 0)
    assert.equal(next.hero.attack, 0)
    assert.throws(() => nextCampaignBattle(next), /finished/)
  }
})

test('campaigns carry CPU-spent herbs and magic through the battle instead of refilling them', () => {
  const state = strong(createCampaign('C2', heroCode))
  state.hero.hp = 100
  state.hero.pp = 5
  const session = createBattle(state.hero, campaignEnemy(state), seeded(7))
  let snapshot = session.snapshot()
  while (!snapshot.result) snapshot = session.auto()
  const next = nextCampaignBattle(state, seeded(7))
  assert.equal(next.result.winner, 'left')
  assert.equal(next.state.hero.pp, Math.min(99, snapshot.left.pp + 5))
  assert.equal(next.state.hero.mp, snapshot.left.mp)
  assert.ok(snapshot.left.pp < state.hero.pp)
})

test('original C2 password checksum and growth work and reject malformed passwords', () => {
  const state = createCampaign('C2', heroCode)
  assert.equal(campaignPassword(state, 10), '11006')
  const powered = useCampaignPassword(state, '11006')
  assert.deepEqual([powered.hero.hp, powered.hero.attack, powered.hero.defense], [11500,4100,3700])
  assert.equal(state.hero.hp, 5000)
  for (const password of ['11007', '12006', 'abcde', '11006extra', '']) {
    assert.throws(() => useCampaignPassword(state, password), /Invalid C2 password/)
  }
  for (const level of [-1, 100, NaN, 1.5]) assert.throws(() => campaignPassword(state, level), /level/)
  assert.throws(() => useCampaignPassword({ ...state, stage: 1 }, '11006'), /new campaign/)
})

test('C1 original jump passwords expose E5 and E6, not fabricated normal stages', () => {
  const state = createCampaign('C1', heroCode)
  const e5 = useCampaignPassword(state, '317')
  const e6 = useCampaignPassword(state, '386')
  assert.equal(e5.chapter, 4)
  assert.equal(e6.chapter, 5)
  assert.equal(campaignEnemy(e5).name, 'E-5 L-1 01')
  assert.equal(campaignEnemy(e6).name, 'E-6 L-1 01')
  assert.throws(() => useCampaignPassword(state, '316'), /Unsupported/)
})

test('C1 original starting powerup passwords and UI setup options apply real rules', () => {
  const powered = createCampaign('C1', heroCode, undefined, { password: '815' })
  assert.deepEqual([powered.hero.hp, powered.hero.attack, powered.hero.defense], [7400,2700,2500])
  const equipped = createCampaign('C2', heroCode, '0000400603238', { enemyBarcode: '4901234567894', password: '11006' })
  assert.equal(equipped.hero.attack, 4500)
  assert.equal(campaignEnemy(equipped).barcode, '4901234567894')
  assert.equal(equipped.hero.hp, 11500)
})
