import test from 'node:test'
import assert from 'node:assert/strict'
import { battle, combine, createBattle, createDuel, decodeBarcode, MAGIC_COSTS, stepDuel, validateBarcode } from '../src/game.ts'
import type { Fighter } from '../src/game.ts'

// Build valid cards without relying on the implementation's validator.
function card(payload: string): string {
  let sum = 0
  for (let i = payload.length - 1, weight = 3; i >= 0; i--, weight = 4 - weight) sum += Number(payload[i]) * weight
  return payload + (10 - sum % 10) % 10
}
function seeded(seed: number) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 4294967296
  }
}
const leftCode = '4901234567894'
const rightCode = '96385074'
function fighter(overrides: Partial<Fighter> = {}): Fighter {
  return { ...decodeBarcode(leftCode), barcode: card('050101000000'), hp: 10000, attack: 2000, defense: 1000, speed: 5, race: 0, job: 0, special: 0, ...overrides }
}
const stats = (f: Fighter) => [f.hp, f.attack, f.defense, f.speed, f.race, f.job, f.special, f.mp, f.pp]

test('JAN/EAN checksum validation is strict for both lengths and keeps leading zeros', () => {
  for (const code of [leftCode, rightCode, '00000000', '0000000000000', '12345670']) assert.equal(validateBarcode(code), true, code)
  for (const code of ['', '1234567', '4901234567890', '96385075', ' 96385074', '96385074\n', 'abcdefgh', '１２３４５６７０', '1e000000']) {
    assert.equal(validateBarcode(code), false, code)
    assert.throws(() => decodeBarcode(code), /Invalid/)
  }
})

test('13-digit post-reading fixture uses displayed x100 units', () => {
  const f = decodeBarcode(leftCode)
  assert.deepEqual(stats(f), [48700, 5200, 4300, 8, 4, 3, 18, 0, 5])
  assert.equal(f.reading, 'post')
  assert.equal(f.kind, 'fighter')
})

test('8-digit reading has fixed job, no MP, and preserves leading zeros', () => {
  assert.deepEqual(stats(decodeBarcode(rightCode)), [30500, 7000, 2500, 0, 4, 4, 20, 0, 5])
  assert.deepEqual(stats(decodeBarcode('12345670')), [36500, 3000, 2100, 6, 0, 4, 16, 0, 5])
  assert.deepEqual(stats(decodeBarcode('00000000')), [0, 7500, 7700, 0, 0, 4, 0, 0, 5])
})

test('pre-reading selects fixed card data and uses the speed digit as part of special', () => {
  const f = decodeBarcode('0501919000186')
  assert.equal(f.reading, 'pre')
  assert.deepEqual(stats(f), [5000, 1900, 1900, 8, 0, 0, 18, 0, 5])
})

test('pre-reading HP>=200 exceptions preserve 255 wrap and mistaken defense assignment', () => {
  const a = decodeBarcode('2099393005004')
  const b = decodeBarcode('2099393105001')
  const c = decodeBarcode('2099393205008')
  assert.deepEqual([a.hp, a.attack, a.defense], [20900, 3800, 19300])
  assert.deepEqual([b.hp, b.attack, b.defense], [20900, 19300, -6200])
  assert.deepEqual([c.hp, c.attack, c.defense], [20900, 19300, 19300])
})

test('pre/post boundary includes low-stat item cards but not high-stat race 5 cards', () => {
  assert.equal(decodeBarcode(card('050191950000')).reading, 'pre')
  assert.equal(decodeBarcode(card('051191950000')).reading, 'post')
  assert.equal(decodeBarcode(card('050201950000')).reading, 'post')
  assert.equal(decodeBarcode(card('050192050000')).reading, 'post')
  assert.equal(decodeBarcode(card('150999940000')).reading, 'pre')
})

test('post-read attack tens of 10/11 are not reduced modulo ten', () => {
  // For EAN8, digit 5 controls attack tens, digit 4 controls its units.
  assert.equal(decodeBarcode(card('1000030')).attack, 10500)
  assert.equal(decodeBarcode(card('4000040')).attack, 11500)
})

test('shift changes only post-read HP/ST/DF, including +2 front wrap', () => {
  const expected = [[36500, 3000, 2100], [47600, 4100, 3200], [48700, 5200, 4300], [29800, 6300, 5400], [900, 7400, 6100]]
  for (const [i, shift] of ([-2, -1, 0, 1, 2] as const).entries()) {
    const f = decodeBarcode(leftCode, { shift })
    assert.deepEqual([f.hp, f.attack, f.defense], expected[i])
    assert.deepEqual([f.speed, f.job, f.special], [8, 3, 18])
  }
  assert.deepEqual(stats(decodeBarcode('0501919000186', { shift: 2 })), stats(decodeBarcode('0501919000186')))
})

test('C1/C2 hero mode scales post-read stats but preserves pre-read hero data', () => {
  for (const mode of ['C1', 'C2'] as const) {
    assert.deepEqual(stats(decodeBarcode(leftCode, { mode })), [4800, 600, 700, 8, 4, 3, 18, 0, 5])
    assert.equal(decodeBarcode('0501919000186', { mode }).hp, 5000)
    assert.throws(() => decodeBarcode(card('050191900000'), { mode }), /hero/)
  }
  assert.equal(decodeBarcode('0501010000504', { hero: true }).special, 50)
  assert.throws(() => decodeBarcode(card('060101000050')), /limits/)
  assert.throws(() => decodeBarcode(leftCode, { job: 'magician' }), /job/)
})

test('original job 6 MP inconsistency is retained', () => {
  const f = decodeBarcode(card('050101006018'))
  assert.equal(f.job, 6)
  assert.equal(f.mp, 10)
  assert.doesNotThrow(() => decodeBarcode(f.barcode, { job: 'warrior' }))
  assert.throws(() => decodeBarcode(f.barcode, { job: 'magician' }))
})

test('items decode independently but never enter battle standalone', () => {
  const weapon = decodeBarcode('00000505')
  const armor = decodeBarcode('00000017')
  const hp = decodeBarcode('00000079')
  assert.deepEqual([weapon.kind, weapon.race, weapon.attack], ['item', 5, 1500])
  assert.deepEqual([armor.kind, armor.race, armor.defense], ['item', 7, 1700])
  assert.deepEqual([hp.kind, hp.race, hp.hp], ['item', 9, 0])
  assert.throws(() => battle(weapon, fighter()), /Items/)
  assert.throws(() => battle(fighter(), armor), /Items/)
})

test('cursed pre-read items flip their appropriate stat with injected RNG', () => {
  for (const [code, key, expected] of [
    ['0501010900309', 'hp', 5000], ['0501010500318', 'attack', 1000], ['0501010700329', 'defense', 1000],
  ] as const) {
    assert.equal(decodeBarcode(code, { rng: () => 0 })[key], -expected)
    assert.equal(decodeBarcode(code, { rng: () => 0.5 })[key], expected)
  }
})

test('fusion caps stats, retains base speed and original component values', () => {
  const a = fighter({ hp: 90000, attack: 18000, defense: 19000 })
  const b = fighter({ barcode: rightCode, hp: 20000, attack: 5000, defense: 5000, speed: 9 })
  const f = combine(a, b)
  assert.equal(f.barcode, a.barcode, 'product identity remains the primary card')
  assert.deepEqual([f.hp, f.maxHp, f.attack, f.defense, f.speed], [99900, 99900, 19900, 19900, 5])
  assert.deepEqual([f.attack1, f.attack2, f.defense1, f.defense2], [18000, 5000, 19000, 5000])
  assert.equal(f.union, true)
  assert.equal(f.pp, 5)
  assert.equal(f.mp, 0)
  assert.equal(a.attack, 18000)
})

test('item assembly accepts herb/MP items and keeps weapons and armour off magicians', () => {
  const mage = fighter({ job: 7, mp: 10, pp: 95 })
  const herbs = decodeBarcode('0501010970005')
  const mp = decodeBarcode('0501010980004')
  assert.equal(combine(mage, herbs).pp, 99)
  assert.equal(combine(mage, mp).mp, 20)
  assert.throws(() => combine(fighter(), mp), /Warriors/)
  assert.throws(() => combine(mage, decodeBarcode('00000505')), /Incompatible/)
  assert.equal(combine(fighter(), decodeBarcode('00000505')).attack, 3500)
  const curse = decodeBarcode('0501010500318', { rng: () => 0 })
  assert.equal(combine(fighter({ attack: 500 }), curse).attack, 0)
})

test('fusion rejects matching suffixes, standalone item bases and C2 mismatches', () => {
  assert.throws(() => combine(fighter(), fighter()), /suffixes/)
  assert.throws(() => combine(decodeBarcode('00000505'), fighter()), /First/)
  const other = fighter({ barcode: rightCode, race: 4, job: 4 })
  assert.doesNotThrow(() => combine(fighter(), other))
  assert.throws(() => combine(fighter(), other, { mode: 'C1' }), /C1/)
  assert.throws(() => combine(fighter(), other, { mode: 'C2' }), /C2/)
  const info = decodeBarcode(card('050101095000'))
  assert.throws(() => combine(fighter(), info), /C1/)
  assert.doesNotThrow(() => combine(fighter(), info, { mode: 'C1' }))
})

test('battle deterministic fixture retains double application of the first-slot shield', () => {
  const a = decodeBarcode(leftCode), b = decodeBarcode(rightCode)
  const before = structuredClone([a, b])
  assert.deepEqual(battle(a, b, () => 0.5), {
    winner: 'left', rounds: 3, leftHp: 33700, rightHp: 0,
    leftMp: 0, rightMp: 0, leftPp: 5, rightPp: 5,
    log: ['守護星 2', '1P 攻撃 19000', '1P CRITICAL', '2P 攻撃 15000', '2P CRITICAL', '1P 攻撃 19000', '1P CRITICAL'],
  })
  assert.deepEqual([a, b], before)
})

test('seeded RNG produces repeatable combat and different seeds change its log', () => {
  const a = decodeBarcode(leftCode), b = decodeBarcode(rightCode)
  const result = battle(a, b, seeded(42))
  assert.deepEqual(result, battle(a, b, seeded(42)))
  assert.notDeepEqual(result.log, battle(a, b, seeded(43)).log)
  assert.ok(result.rounds > 0)
  assert.ok(result.leftHp === 0 || result.rightHp === 0)
})

test('ability 45 cancellation is simultaneous and does not mutate inputs', () => {
  const a = fighter({ special: 45 }), b = fighter({ barcode: rightCode, special: 18 })
  const baseline = battle(fighter(), { ...b, special: 0 }, seeded(5))
  assert.deepEqual(battle(a, b, seeded(5)), baseline)
  assert.equal(b.special, 18)
})

test('ability 37 applies only in the first special slot for initiative', () => {
  const a = fighter({ speed: 0, special: 37 }), b = fighter({ barcode: rightCode, speed: 1 })
  assert.match(battle(a, b, () => 0.5).log[1], /^1P/)
  assert.match(battle({ ...a, special: 0, special2: 37 }, b, () => 0.5).log[1], /^2P/)
})

test('debuffs change base components and strongest same-category ability wins', () => {
  const a = fighter({ special: 23, special2: 24 })
  const b = fighter({ barcode: rightCode })
  assert.deepEqual(battle(a, b, seeded(17)), battle({ ...a, special: 0 }, b, seeded(17)))
  assert.notDeepEqual(battle(a, b, seeded(17)).log, battle({ ...a, special: 0, special2: 0 }, b, seeded(17)).log)
})

test('single-use weapons and armor break only following a nonlethal hit', () => {
  const a = combine(fighter(), decodeBarcode('00000505'))
  const b = combine(fighter({ barcode: rightCode }), decodeBarcode('00000017'))
  const result = battle(a, b, () => 0.5)
  assert.equal(result.log.filter(line => line === '1P 武器破損').length, 1)
  assert.equal(result.log.filter(line => line === '2P 防具破損').length, 1)
  const lethal = battle({ ...a, attack: 19900, attack1: 18400 }, { ...b, hp: 100 }, () => 0.5)
  assert.ok(!lethal.log.some(line => line.includes('破損')))
})

test('zero HP resolves immediately and hostile RNG cannot cause an infinite duel', () => {
  const result = battle(fighter({ hp: 0 }), fighter(), () => 0.5)
  assert.equal(result.winner, 'right')
  assert.equal(result.rounds, 0)
  const bounded = battle(fighter({ attack: 0, special: 16 }), fighter({ attack: 0, special: 16 }), () => 0)
  assert.equal(bounded.rounds, 2000)
  assert.equal(bounded.winner, 'left')
  assert.match(bounded.log.at(-1)!, /2000/)
})

test('invalid RNG and nonfinite/malformed combat stats fail explicitly', () => {
  for (const value of [NaN, Infinity, -1, 1]) assert.throws(() => battle(fighter(), fighter(), () => value), /RNG/)
  for (const overrides of [{ hp: NaN }, { attack: Infinity }, { race: -1 }, { hp: 123 }]) {
    assert.throws(() => battle(fighter(overrides), fighter()), /Invalid/)
  }
})

function interactive() {
  return createBattle(
    fighter({ hp: 10000, maxHp: 50000, job: 7, mp: 99, speed: 9 }),
    fighter({ barcode: rightCode, hp: 50000, job: 7, mp: 99, speed: 0, defense: 10000 }),
    () => 0.5,
  )
}

test('interactive actions alternate turns and snapshots cannot mutate the duel', () => {
  const session = interactive()
  const initial = session.snapshot()
  assert.equal(initial.turn, 'left')
  initial.left.hp = 0
  initial.log.push('tampered')
  const after = session.act({ type: 'attack', timing: 2 })
  assert.equal(after.turn, 'right')
  assert.equal(after.rounds, 1)
  assert.equal(after.left.hp, 10000)
  assert.ok(!after.log.includes('tampered'))
  const automatic = session.auto()
  assert.equal(automatic.turn, 'left')
  assert.equal(automatic.rounds, 2)
})

test('invalid interactive actions consume neither turn nor resources', () => {
  const session = interactive()
  const before = session.snapshot()
  assert.throws(() => session.act({ type: 'herbs', amount: 4 } as never), /Herbs/)
  assert.throws(() => session.act({ type: 'magic', spell: 10 } as never), /Magic/)
  assert.throws(() => session.act({ type: 'attack', timing: 3 } as never), /timing/)
  assert.deepEqual(session.snapshot(), before)
  const warrior = createBattle(fighter({ speed: 9 }), fighter({ speed: 0 }), () => 0.5)
  assert.throws(() => warrior.act({ type: 'magic', spell: 0 }), /Magic/)
})

test('interactive F0 transfers 1–6 MP, caps at 99, and is available at zero mage MP', () => {
  const session = interactive()
  const after = session.act({ type: 'magic', spell: 0 })
  assert.equal(after.left.mp, 99)
  assert.equal(after.right.mp, 95)
  const empty = createBattle(fighter({ speed: 9, job: 7, mp: 0 }), fighter({ speed: 0, mp: 10 }), () => 0.5)
  assert.equal(empty.act({ type: 'magic', spell: 0 }).left.mp, 4)
})

test('all F1–F9 spells consume the original listed MP amount', () => {
  for (const spell of [1, 2, 3, 4, 5, 6, 7, 8, 9] as const) {
    const after = interactive().act({ type: 'magic', spell })
    assert.equal(after.left.mp, 99 - MAGIC_COSTS[spell], `F${spell}`)
    assert.equal(after.rounds, 1)
    assert.equal(after.turn, 'right')
  }
})

test('F3/F4 heal and F5–F8 modify only base-stat components', () => {
  const f3 = interactive().act({ type: 'magic', spell: 3 })
  const f4 = interactive().act({ type: 'magic', spell: 4 })
  assert.ok(f3.left.hp > 10000)
  assert.ok(f4.left.hp > f3.left.hp)
  assert.ok(f4.left.hp <= 50000)
  const f5 = interactive().act({ type: 'magic', spell: 5 })
  assert.equal(f5.right.defense, 7000)
  assert.equal(f5.right.defense1, 7000)
  assert.equal(interactive().act({ type: 'magic', spell: 6 }).left.defense, 1300)
  assert.equal(interactive().act({ type: 'magic', spell: 7 }).right.attack, 1400)
  assert.equal(interactive().act({ type: 'magic', spell: 8 }).left.attack, 2600)
})

test('F9 blocks both herb menus and power, but not attacks or healing magic', () => {
  const session = interactive()
  session.act({ type: 'magic', spell: 9 })
  const before = session.snapshot()
  assert.equal(before.herbsBlocked.right, true)
  assert.throws(() => session.act({ type: 'herbs', amount: 1 }), /Herbs/)
  assert.throws(() => session.act({ type: 'power' }), /Herbs/)
  assert.deepEqual(session.snapshot(), before)
  assert.doesNotThrow(() => session.act({ type: 'magic', spell: 3 }))
})

test('herbs spend the chosen count and power spends exactly one', () => {
  const herbs = interactive().act({ type: 'herbs', amount: 3 })
  const power = interactive().act({ type: 'power', timing: 14 })
  assert.equal(herbs.left.pp, 2)
  assert.equal(power.left.pp, 4)
  assert.ok(herbs.left.hp > 10000)
  assert.ok(power.left.hp > 10000)
})

test('interactive results stop further actions, while auto wrapper remains identical', () => {
  const a = decodeBarcode(leftCode), b = decodeBarcode(rightCode)
  const session = createBattle(a, b, seeded(123))
  let snapshot = session.snapshot()
  while (!snapshot.result) snapshot = session.auto()
  assert.deepEqual(snapshot.result, battle(a, b, seeded(123)))
  assert.throws(() => session.act({ type: 'attack' }), /ended/)
  assert.throws(() => session.auto(), /ended/)
})

test('duel aliases delegate to the same interactive mechanics', () => {
  const a = fighter({ speed: 9 }), b = fighter({ speed: 0 })
  const session = createDuel(a, b, () => 0.5)
  const reference = createBattle(a, b, () => 0.5)
  assert.deepEqual(stepDuel(session, { type: 'attack', timing: 2 }), reference.act({ type: 'attack', timing: 2 }))
})

test('magician union MP is zero below the original ten-MP eligibility threshold', () => {
  const a = fighter({ job: 7, mp: 9 })
  const b = fighter({ barcode: rightCode, job: 7, mp: 9 })
  assert.equal(combine(a, b).mp, 0)
  assert.equal(combine(a, { ...b, mp: 10 }).mp, 9)
  assert.equal(combine({ ...a, mp: 10 }, b).mp, 10)
  assert.equal(combine({ ...a, job: 6, mp: 10 }, b).mp, 0)
})

test('card labels follow the published race and job table', () => {
  assert.equal(decodeBarcode(leftCode).name, 'ヒューマン族・戦士')
  assert.equal(decodeBarcode('00000505').name, '武器（使い捨て）')
  assert.equal(decodeBarcode('0501010970005').name, '薬草アップ')
  assert.equal(decodeBarcode('0501010980004').name, 'MPアップ')
})

test('campaigns can retain a fixed guardian star without drawing another one', () => {
  let calls = 0
  const rng = () => { calls++; return 0.5 }
  const a = fighter({ speed: 9 }), b = fighter({ speed: 0 })
  const first = createBattle(a, b, rng, { star: 2 })
  assert.equal(first.snapshot().star, 2)
  assert.equal(first.snapshot().log[0], '守護星 3')
  assert.equal(calls, 2, 'fixed star consumes only the two initiative rolls')
  assert.equal(createBattle(a, b, () => 0.5).snapshot().star, 1)
  assert.throws(() => createBattle(a, b, rng, { star: 3 } as never), /guardian star/)
})

test('critical labels do not apply another damage multiplier', () => {
  const a = decodeBarcode(leftCode), b = decodeBarcode(rightCode)
  const session = createBattle(a, b, () => 0.5)
  const after = session.act({ type: 'attack' })
  assert.equal(after.right.hp, 11500)
  assert.ok(after.log.includes('1P CRITICAL'))
})

test('noHeal bans POWER, herbs and healing magic, and stops the CPU from using POWER', () => {
  const mage = fighter({ job: 7, mp: 10 })
  const session = createBattle(mage, fighter({ barcode: rightCode }), () => 0, { star: 0, noHeal: true })
  const turn = session.snapshot().turn
  for (const action of [{ type: 'power' }, { type: 'herbs', amount: 1 }, { type: 'magic', spell: 3 }, { type: 'magic', spell: 4 }] as const) {
    if (turn === 'left' || action.type !== 'magic') assert.throws(() => session.act(action), /Healing/)
  }
  // A CPU near death with herbs left would POWER (roll > 50) without the rule.
  let draws = 0
  const rng = () => [0.99, 0.99][draws++ % 2] ?? 0.99
  const weak = { ...fighter({ hp: 10000 }), maxHp: 10000 }
  const strong = fighter({ barcode: rightCode, hp: 99900, attack: 100, defense: 19900 })
  const result = battle({ ...weak, hp: 1000 }, strong, rng, { star: 0, noHeal: true })
  assert.equal(result.log.some(line => line.includes('回復')), false)
})
