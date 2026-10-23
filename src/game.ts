/**
 * Rules adapted from original author finalfighter:
 * https://github.com/finalfighter/BarcodeBattler2-Simulator
 * Source: src/BarcodeRead.as, src/CreateFightingData.as, src/FightingCalc.as,
 * src/FightingData.as, src/BarcodeWorld.as, src/NES.as and src/barcode2.as.
 * Upstream README labels the project MIT; no root LICENSE file is supplied.
 * No upstream graphics, audio, or other media are included.
 * HP / attack / defense are DISPLAY values (original internal values × 100).
 * The automatic duel applies the original CPU policy to both players; it is
 * not the original interactive C1/C2 campaign. createBattle exposes individual
 * attacks, power, herbs and F0–F9 magic; campaign progression, escape, password
 * encoding, animation and timing UI are outside this module.
 */
export interface Fighter {
  barcode: string
  name: string
  kind: 'fighter' | 'item'
  hp: number
  attack: number
  defense: number
  speed: number
  race: number
  job: number
  special: number
  mp: number
  pp: number
  reading: 'pre' | 'post'
  maxHp?: number
  attack1?: number
  attack2?: number
  defense1?: number
  defense2?: number
  race2?: number
  special2?: number
  union?: boolean
}

export interface DecodeOptions {
  mode?: 'C0' | 'C1' | 'C2'
  hero?: boolean
  shift?: -2 | -1 | 0 | 1 | 2
  job?: 'warrior' | 'magician'
  rng?: () => number
}

/** Race and job labels from https://barcodebattler.net/page01.htm (種族・職業). */
export const RACE_NAMES: readonly string[] = Object.freeze([
  '機械族', 'アニマル族', '魚族', 'バード族', 'ヒューマン族',
  '武器（使い捨て）', '武器', '防具（使い捨て）', '防具', 'HPアップ',
])
export const jobName = (job: number) => job <= 6 ? '戦士' : '魔法使い'
/** Race 9 pre-read cards also carry info, herb and MP cards (BarcodeRead.as). */
function itemName(f: Pick<Fighter, 'race' | 'job'>) {
  if (f.race !== 9) return RACE_NAMES[f.race]
  return f.job === 5 || f.job === 6 ? '情報カード' : f.job === 7 ? '薬草アップ' : f.job >= 8 ? 'MPアップ' : RACE_NAMES[9]
}
const randomInt = (rng: () => number, n: number) => {
  const value = rng()
  if (!Number.isFinite(value) || value < 0 || value >= 1) throw new Error('RNG must return a number in [0, 1)')
  return Math.floor(value * n)
}

/** Strict JAN/EAN checksum validation, including leading zeroes. */
export function validateBarcode(barcode: string): boolean {
  if (typeof barcode !== 'string' || !/^(?:[0-9]{8}|[0-9]{13})$/.test(barcode)) return false
  let sum = 0
  for (let i = barcode.length - 2, weight = 3; i >= 0; i--, weight = 4 - weight) sum += Number(barcode[i]) * weight
  return (10 - sum % 10) % 10 === Number(barcode.at(-1))
}

export function decodeBarcode(barcode: string, options: DecodeOptions = {}): Fighter {
  if (!validateBarcode(barcode)) throw new Error('Invalid JAN/EAN barcode or checksum')
  const d = (index: number) => Number(barcode.charAt(index))
  const pair = (index: number) => Number(barcode.slice(index, index + 2))
  const pre = barcode.length === 13 && (
    (d(0) <= 1 && (d(7) <= 4 || (Number(barcode.slice(0, 3)) <= 50 && pair(3) <= 19 && pair(5) <= 19))) ||
    (d(0) > 1 && d(2) === 9 && d(9) === 5))
  const f: Fighter = {
    barcode, name: '', kind: 'fighter', hp: 0, attack: 0, defense: 0,
    speed: 0, race: pre ? d(7) : d(barcode.length - 1), job: 0,
    special: 0, mp: 0, pp: 0, reading: pre ? 'pre' : 'post',
  }
  const rng = options.rng ?? Math.random
  let shift: number = options.shift ?? 0
  if (![-2, -1, 0, 1, 2].includes(shift)) throw new Error('Invalid barcode shift')
  if (pre) {
    f.special = pair(10)
    if (f.race <= 4) {
      f.hp = Number(barcode.slice(0, 3))
      f.attack = pair(3)
      f.defense = pair(5)
      // These branches are unreachable for ordinary pre-read cards, but are
      // retained for the exceptional xx9xxxxxx5xxx pre-reading route.
      if (f.hp >= 200) {
        if (f.race === 0 || f.race === 1) {
          if ([13, 29, 45, 61, 77, 93].includes(f.race === 0 ? f.attack : f.defense)) {
            f.attack += 100
            f.defense += 100
          }
          if (f.race === 0) {
            f.attack += 100
            if (f.attack > 256) f.attack -= 255
          } else {
            f.defense += 100
            // Original assigns ST - 255, not DF - 255.
            if (f.defense > 256) f.defense = f.attack - 255
          }
        } else if (f.race === 2) {
          f.attack += 100
          f.defense += 100
        }
      }
      f.speed = d(11)
      f.job = d(8)
      f.pp = 5
      f.mp = f.job >= 6 ? 10 : 0
    } else if (f.race <= 6) {
      f.attack = pair(3)
      if (f.special === 31 && randomInt(rng, 2) === 0) f.attack *= -1
    } else if (f.race <= 8) {
      f.defense = pair(5)
      if (f.special === 32 && randomInt(rng, 2) === 0) f.defense *= -1
    } else {
      f.job = d(8)
      if (f.job <= 4) {
        f.hp = Number(barcode.slice(0, 3))
        if (f.special === 30 && randomInt(rng, 2) === 0) f.hp *= -1
      } else if (f.job === 7) f.pp = pair(3)
      else if (f.job >= 8) f.mp = pair(5)
    }
  } else {
    const offset = barcode.length === 13 ? 5 : 0
    if (shift === 2) shift = barcode.length === 13 ? -8 : -3
    const n = (index: number) => d(offset + index)
    if (f.race <= 4) {
      f.hp = Number(`${Math.floor(n(6 + shift) / 2)}${n(5 + shift)}${n(4 + shift)}`)
      let tens = n(5 + shift) + 7
      if (tens > 11) tens -= 10
      f.attack = Number(`${tens}${(n(4 + shift) + 5) % 10}`)
      f.defense = Number(`${(n(4 + shift) + 7) % 10}${(n(3 + shift) + 7) % 10}`)
      f.speed = n(5)
      f.job = barcode.length === 13 ? d(5) : 4
      f.pp = 5
      f.mp = barcode.length === 13 && f.job >= 6 ? 10 : 0
    } else if (f.race <= 6) {
      f.attack = (n(5) >= 5 && n(5) <= 8 ? 10 : n(5) === 3 || n(5) === 4 ? 30 : 20) + (n(4) + 5) % 10
    } else if (f.race <= 8) {
      f.defense = (n(4) >= 3 && n(4) <= 6 ? 0 : n(4) === 1 || n(4) === 2 ? 20 : 10) + (n(3) + 7) % 10
    } else {
      f.hp = Number(`${Math.floor(n(6) / 8)}${n(5)}${n(4)}`)
    }
    f.special = (n(3) <= 3 ? 0 : n(3) >= 8 ? 20 : 10) + n(5)
  }
  f.kind = f.race <= 4 ? 'fighter' : 'item'
  const hero = options.hero ?? (options.mode === 'C1' || options.mode === 'C2')
  if (f.kind === 'fighter') {
    if (hero && pre && f.special !== 18 && f.special !== 50) throw new Error('This card is not a hero')
    if (f.special === 50 && (f.hp >= 60 || f.attack >= 20 || f.defense >= 20)) throw new Error('Hero card exceeds starting limits')
    if (hero && !pre) {
      f.hp = Math.floor(f.hp / 10)
      f.attack = Math.floor(f.attack / 10) + 1
      f.defense = Math.floor(f.defense / 10) + 3
    }
    if (options.job === 'warrior' && f.job > 6 || options.job === 'magician' && f.job <= 6) throw new Error('Card has the wrong job')
  }
  f.name = f.kind === 'fighter' ? `${RACE_NAMES[f.race]}・${jobName(f.job)}` : itemName(f)
  f.hp *= 100
  f.attack *= 100
  f.defense *= 100
  return f
}

/** Two-card CreateFightingData assembly, with BarcodeRead admission checks. */
export function combineFighters(first: Fighter, second: Fighter, options: { mode?: 'C0' | 'C1' | 'C2' } = {}): Fighter {
  if (first.kind !== 'fighter' || first.race > 4) throw new Error('First card must be a fighter')
  if (first.barcode.slice(-7) === second.barcode.slice(-7)) throw new Error('Cannot combine identical card suffixes')
  if ((options.mode === 'C1' || options.mode === 'C2') && second.race <= 4 && (first.race !== second.race || first.job !== second.job)) throw new Error(`${options.mode} fusion requires the same race and job`)
  if (second.race === 9 && (second.job === 5 || second.job === 6) && options.mode !== 'C1') throw new Error('Information cards require C1 mode')
  if (second.race === 9 && second.job >= 8 && first.job <= 6) throw new Error('Warriors cannot use MP items')
  // BarcodeRead's comment says magicians cannot equip weapons or armour, but its
  // code tests the second card's job, which is never >= 7 for those items. Apply
  // the documented rule to the magician (first card) instead.
  if (first.job >= 7 && second.race >= 5 && second.race <= 8) throw new Error('Incompatible equipment')
  const union = second.race <= 4
  return {
    ...first, name: `${first.name} + ${second.name}`,
    hp: Math.min(99900, first.hp + second.hp),
    maxHp: Math.min(99900, first.hp + second.hp),
    attack: Math.max(0, Math.min(19900, first.attack + second.attack)),
    defense: Math.max(0, Math.min(19900, first.defense + second.defense)),
    attack1: first.attack, attack2: second.attack,
    defense1: first.defense, defense2: second.defense,
    pp: Math.min(99, first.pp + (union ? 0 : second.pp)),
    mp: Math.min(99, first.job <= 6 ? 0 : union ? first.mp >= 10 || second.mp >= 10 ? first.mp : 0 : first.mp + second.mp),
    race2: second.race, special2: second.special, union,
  }
}
export const combine = combineFighters

// NES.as intentionally wraps addition/borrow by 255, not 256. BarcodeWorld's
// 16-bit multiply also ORs its remaining low/high multiplier bytes together.
class Arithmetic {
  carry = 0
  adc(a: number, b: number) { const n = a + b + this.carry; this.carry = Number(n > 255); return n > 255 ? n - 255 : n }
  sbc(a: number, b: number) { const n = a - b - (this.carry ? 0 : 1); this.carry = Number(n >= 0); return n < 0 ? n + 255 : n }
  shift(n: number, left: boolean, rotate = false) {
    const bits = n.toString(2).padStart(8, '0')
    const result = left ? bits.slice(1, 8) + (rotate ? this.carry : 0) : (rotate ? this.carry : 0) + bits.slice(0, 7)
    this.carry = Number(bits[left ? 0 : 7])
    return parseInt(result, 2)
  }
}
const bytes = (n: number, count: number) => Array.from({ length: count }, (_, i) => Math.floor(n / 256 ** i) & 255)
const number = (b: number[]) => b.reduce((n, v, i) => n + v * 256 ** i, 0)
function multiply(a: number, b: number, wide = false): number {
  const m = new Arithmetic(), x = wide ? bytes(a, 2) : [a], y = wide ? bytes(b, 4) : [b, 0], out = y.map(() => 0)
  do {
    if (wide) x[1] = m.shift(x[1], false)
    x[0] = m.shift(x[0], false, wide)
    if (m.carry) {
      m.carry = 0
      for (let i = 0; i < out.length; i++) out[i] = m.adc(y[i], out[i])
    }
    for (let i = 0; i < y.length; i++) y[i] = m.shift(y[i], true, i > 0)
    if (wide) x[0] |= x[1]
  } while (x[0])
  return number(out)
}
function divide(a: number, b: number, count = 2): number {
  const m = new Arithmetic(), x = bytes(a, count), y = bytes(b, count), out = x.map(() => 0), rem = x.map(() => 0)
  for (let step = 0; step < count * 8; step++) {
    for (let i = 0; i < count; i++) out[i] = m.shift(out[i], true, i > 0)
    for (let i = 0; i < count; i++) x[i] = m.shift(x[i], true, i > 0)
    for (let i = 0; i < count; i++) rem[i] = m.shift(rem[i], true, true)
    if (number(rem) >= number(y)) {
      m.carry = 1
      for (let i = 0; i < count; i++) rem[i] = m.sbc(rem[i], y[i])
      // NES.inc(255) becomes 1, so the higher-byte increment is unreachable.
      out[0] = out[0] === 255 ? 1 : out[0] + 1
    }
  }
  return number(out)
}
const scale = (value: number, rate: number) => Math.min(999, divide(multiply(value, rate, true), 10, 4))
const raceTable = [[10, 8, 12, 12, 8], [12, 10, 8, 12, 8], [8, 12, 10, 12, 8], [8, 8, 8, 10, 12], [12, 12, 12, 8, 10]]
const starTable = [[12, 10, 8], [8, 12, 10], [10, 8, 12], [12, 10, 8], [8, 12, 10]]
type State = ReturnType<typeof state>
function state(f: Fighter) {
  if (f.kind !== 'fighter' || f.race > 4) throw new Error('Items cannot battle standalone')
  for (const value of [f.hp, f.attack, f.defense, f.speed, f.race, f.job, f.special, f.mp, f.pp]) {
    if (!Number.isFinite(value) || !Number.isInteger(value)) throw new Error('Invalid fighter stats')
  }
  if (f.race < 0 || f.race > 4 || f.job < 0 || f.job > 9 || f.speed < 0 || f.speed > 9 ||
    f.hp < 0 || f.hp > 99900 || f.hp % 100 || f.attack % 100 || f.defense % 100) throw new Error('Invalid fighter stats')
  return { ...f, hp: f.hp / 100, max: (f.maxHp ?? f.hp) / 100,
    st: f.attack / 100, df: f.defense / 100,
    st1: (f.attack1 ?? f.attack) / 100, st2: (f.attack2 ?? 0) / 100,
    df1: (f.defense1 ?? f.defense) / 100, df2: (f.defense2 ?? 0) / 100,
    specials: [f.special, f.special2 ?? 0], weaponBroken: false, armorBroken: false, herbsBlocked: false }
}
const has = (f: State, special: number) => f.specials.includes(special)
function debuff(source: State, target: State) {
  for (const group of [[23, 24], [25, 26, 27], [28, 29]]) {
    const active = group.filter(s => has(source, s))
    if (active.length > 1) source.specials = source.specials.map(s => active.includes(s) && s !== Math.max(...active) ? 0 : s)
  }
  for (const [s, rate] of [[23, 7], [24, 5], [25, 7], [26, 5], [27, 2], [28, 7], [29, 5]]) {
    if (!has(source, s)) continue
    if (s <= 24) { target.st1 = divide(multiply( rate, target.st1), 10) & 255; target.st = target.st1 + target.st2 }
    else if (s <= 27) { target.df1 = divide(multiply(rate, target.df1), 10) & 255; target.df = target.df1 + target.df2 }
    else { target.hp = divide(multiply( rate, target.hp, true), 10); target.max = target.hp }
    break // The original is a single else-if chain, not independent effects.
  }
}

export interface BattleResult {
  winner: 'left' | 'right'
  rounds: number
  log: string[]
  leftHp: number
  rightHp: number
  leftMp: number
  rightMp: number
  leftPp: number
  rightPp: number
}
export type BattleAction =
  | { type: 'attack'; timing?: 1 | 2 }
  | { type: 'power'; timing?: 10 | 14 }
  | { type: 'herbs'; amount: 1 | 2 | 3 }
  | { type: 'magic'; spell: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9; timing?: 1 | 2 }
export interface BattleSnapshot {
  left: Fighter
  right: Fighter
  turn: 'left' | 'right'
  rounds: number
  log: string[]
  herbsBlocked: { left: boolean; right: boolean }
  result: BattleResult | null
  /** Original guardian-star index, retained across encounters by campaigns. */
  star: 0 | 1 | 2
}
export interface BattleOptions { star?: 0 | 1 | 2 }
export interface BattleSession {
  snapshot(): BattleSnapshot
  act(action: BattleAction): BattleSnapshot
  auto(): BattleSnapshot
}
export const MAGIC_COSTS: readonly number[] = Object.freeze([0, 2, 5, 2, 4, 3, 5, 4, 6, 3])

/** Stateful local duel. Invalid actions do not consume a turn or resources. */
export function createBattle(left: Fighter, right: Fighter, rng: () => number = Math.random, options: BattleOptions = {}): BattleSession {
  const fighters = [state(left), state(right)]
  const log: string[] = []
  if (options.star !== undefined && ![0, 1, 2].includes(options.star)) throw new Error('Invalid guardian star')
  const starRoll = options.star === undefined ? randomInt(rng, 500) : 0
  const star = options.star ?? (starRoll < 110 ? 0 : starRoll < 256 ? 1 : 2)
  log.push(`守護星 ${star + 1}`)
  const cancel = fighters.map(f => has(f, 45))
  if (cancel[0]) fighters[1].specials = [0, 0]
  if (cancel[1]) fighters[0].specials = [0, 0]
  debuff(fighters[1], fighters[0])
  debuff(fighters[0], fighters[1])
  const initiative = (a: State, b: State) => {
    const base = (multiply(a.speed, 5) & 255) + randomInt(rng, 9)
    const first = divide(multiply(base, starTable[a.race][star]), 10) & 255
    return (divide(multiply(first, raceTable[a.race][b.race] + 1), 10) & 255) + (a.specials[0] === 37 ? 50 : 0)
  }
  const speeds = [initiative(fighters[0], fighters[1]), initiative(fighters[1], fighters[0])]
  let turn = speeds[0] === speeds[1] ? randomInt(rng, 2) : speeds[0] > speeds[1] ? 0 : 1
  let rounds = 0
  const hit = (a: State, b: State, magicRate = 0) => {
    let add = 0
    if (a.speed >= b.speed) { const m = new Arithmetic(); m.carry = 1; add = m.sbc(a.speed, divide(a.hp, 83) & 255) }
    const base = has(a, 38) ? 230 : has(a, 39) ? 128 : has(b, 40) ? 230 : has(b, 41) ? 128 : 204
    const value = (divide(multiply(base - magicRate, starTable[a.race][star]), 10) & 255) + add
    return value > 255 || value >= randomInt(rng, 256)
  }
  const damage = (a: State, b: State, magicRate = 0, timing?: 1 | 2) => {
    const variable = divide(multiply(randomInt(rng, 5) * 2, a.st), 10)
    const m = new Arithmetic()
    const doubled = m.shift(a.st, true)
    let high = (variable >> 8) + m.carry
    m.carry = 0
    let low = m.adc(variable & 255, doubled)
    high = m.adc(high, 0)
    let value = 0
    if (high > 0 || low >= b.df) {
      m.carry = 1
      low = m.sbc(low, b.df)
      high = m.sbc(high, 0)
      value = high * 256 + low
      let divisor = 2
      if (turn === 0 && b.union) {
        const race = a.union ? b.race : a.race
        divisor = race <= 1 ? 4 : race === 2 ? 3 : 2
      }
      value = divisor === 3 ? divide(value, 3) : Math.floor(value / divisor)
      value = divide(multiply(value, starTable[a.race][star], true), 10)
      value = divide(multiply(value, raceTable[a.race][b.race], true), 10)
    }
    value = (value + 1) * (timing ?? (randomInt(rng, 2) + 1))
    for (const s of a.specials) {
      if (s >= 1 && s <= 10 && s % 10 === b.job || s >= 11 && s <= 15 && (s - 10) % 5 === b.race) value = scale(value, 30)
      else if (s === 16) value = Math.floor(value / 2)
      else if (s === 17 || s === 18) value = scale(value, s === 17 ? 15 : 20)
    }
    if (magicRate) value = scale(value, magicRate)
    // The shield rate is NOT cleared between the first and second slot.
    let shield = 0
    for (const s of b.specials) {
      if (s >= 20 && s <= 22) shield = s === 20 ? 9 : s === 21 ? 7 : 5
      if (shield) value = scale(value, shield)
    }
    return Math.min(999, value)
  }
  const finished = () => fighters[0].hp <= 0 || fighters[1].hp <= 0 || rounds >= 2000
  const result = (): BattleResult | null => {
    if (!finished()) return null
    const winner = fighters[0].hp <= 0 ? 'right' : fighters[1].hp <= 0 ? 'left' :
      fighters[0].hp / Math.max(1, fighters[0].max) >= fighters[1].hp / Math.max(1, fighters[1].max) ? 'left' : 'right'
    return {
      winner, rounds, log: [...log], leftHp: fighters[0].hp * 100, rightHp: fighters[1].hp * 100,
      leftMp: fighters[0].mp, rightMp: fighters[1].mp, leftPp: fighters[0].pp, rightPp: fighters[1].pp,
    }
  }
  const exportFighter = (f: State): Fighter => ({
    barcode: f.barcode, name: f.name, kind: f.kind, reading: f.reading,
    hp: f.hp * 100, maxHp: f.max * 100, attack: f.st * 100, defense: f.df * 100,
    speed: f.speed, race: f.race, job: f.job, pp: f.pp, mp: f.mp,
    special: f.specials[0], special2: f.specials[1], race2: f.race2, union: f.union,
    attack1: f.st1 * 100, attack2: f.st2 * 100, defense1: f.df1 * 100, defense2: f.df2 * 100,
  })
  const snapshot = (): BattleSnapshot => ({
    left: exportFighter(fighters[0]), right: exportFighter(fighters[1]),
    turn: turn === 0 ? 'left' : 'right', rounds, log: [...log],
    herbsBlocked: { left: fighters[0].herbsBlocked, right: fighters[1].herbsBlocked }, result: result(), star,
  })
  const act = (action: BattleAction, automatic = false): BattleSnapshot => {
    if (finished()) throw new Error('Battle has ended')
    const a = fighters[turn], b = fighters[1 - turn]
    if (!action || !['attack', 'power', 'herbs', 'magic'].includes(action.type)) throw new Error('Invalid battle action')
    if ((action.type === 'attack' || action.type === 'magic') && action.timing !== undefined && ![1, 2].includes(action.timing)) throw new Error('Invalid timing')
    if (action.type === 'power' && action.timing !== undefined && ![10, 14].includes(action.timing)) throw new Error('Invalid timing')
    if (action.type === 'power' && (a.pp < 1 || a.herbsBlocked && !automatic)) throw new Error('Herbs are unavailable')
    if (action.type === 'herbs' && (![1, 2, 3].includes(action.amount) || a.pp < action.amount || a.herbsBlocked)) throw new Error('Herbs are unavailable')
    if (action.type === 'magic' && (!Number.isInteger(action.spell) || action.spell < 0 || action.spell > 9 || a.mp < MAGIC_COSTS[action.spell] || !automatic && a.job <= 6)) throw new Error('Magic is unavailable')
    rounds++
    if (action.type === 'power' || action.type === 'herbs') {
      const power = action.type === 'power' ?
        divide(multiply(divide(a.max, 10), [1, 2, 3, 5, 7][randomInt(rng, 5)] * (action.timing ?? (randomInt(rng, 2) === 1 ? 14 : 10)), true), 10) :
        divide(multiply(action.amount * 2, a.max, true), 10)
      // basic_power's 43/44 branches discard shift results in ActionScript.
      const recovered = Math.min(power, a.max - a.hp)
      a.hp += recovered
      a.pp -= action.type === 'herbs' ? action.amount : 1
      log.push(`${turn + 1}P 回復 ${recovered * 100}`)
    } else if (action.type === 'magic' && ![1, 2].includes(action.spell)) {
      const spell = action.spell
      a.mp -= MAGIC_COSTS[spell]
      if (spell === 0) {
        const amount = Math.min(b.mp, randomInt(rng, 6) + 1)
        a.mp = Math.min(99, a.mp + amount)
        b.mp -= amount
      } else if (spell === 3 || spell === 4) {
        a.hp += Math.min(a.max - a.hp, divide(multiply(spell === 3 ? 3 : 5, a.max, true), 10))
      } else if (spell === 5) {
        b.df1 -= divide(multiply(3, b.df1), 10) & 255
        b.df = Math.min(199, b.df1 + b.df2)
      } else if (spell === 6) {
        a.df1 = Math.min(199, a.df1 + (divide(multiply(3, a.df1), 10) & 255))
        a.df = Math.min(199, a.df1 + a.df2)
      } else if (spell === 7) {
        b.st1 -= divide(multiply(3, b.st1), 10) & 255
        b.st = Math.min(199, b.st1 + b.st2)
      } else if (spell === 8) {
        a.st1 = Math.min(199, a.st1 + (divide(multiply(3, a.st1), 10) & 255))
        a.st = Math.min(199, a.st1 + a.st2)
      } else if (spell === 9) b.herbsBlocked = true
      log.push(`${turn + 1}P F${spell}`)
    } else {
      const magicRate = action.type === 'magic' ? action.spell === 1 ? 15 : 20 : 0
      if (action.type === 'magic') a.mp -= MAGIC_COSTS[action.spell]
      if (hit(a, b, magicRate)) {
        const amount = damage(a, b, magicRate, action.timing)
        b.hp = Math.max(0, b.hp - amount)
        log.push(`${turn + 1}P 攻撃 ${amount * 100}`)
        if (amount > a.st + Math.floor(a.st / 2)) log.push(`${turn + 1}P CRITICAL`)
        if (amount > 0 && b.hp > 0) {
          if (a.race2 === 5 && !a.weaponBroken) { a.st -= a.st2; a.weaponBroken = true; log.push(`${turn + 1}P 武器破損`) }
          if (b.race2 === 7 && !b.armorBroken) { b.df -= b.df2; b.armorBroken = true; log.push(`${2 - turn}P 防具破損`) }
        }
      } else log.push(`${turn + 1}P MISS`)
    }
    turn = 1 - turn
    if (rounds === 2000) log.push('2000行動制限: 残HP割合で判定（同率は1P）')
    return snapshot()
  }
  const auto = () => {
    if (finished()) throw new Error('Battle has ended')
    const a = fighters[turn], b = fighters[1 - turn]
    const roll = randomInt(rng, 100) + 1, magicRoll = randomInt(rng, 100) + 1
    // Original CPU directly calls power(), bypassing F9's disabled UI button.
    if (a.hp / a.max < 0.2 && a.pp > 0 && roll > 50) return act({ type: 'power' }, true)
    if (a.mp > 0 && roll >= 70) {
      if (magicRoll >= 40 && magicRoll < 60 && a.mp >= 3 && b.df <= 5) return act({ type: 'magic', spell: 5 }, true)
      if (magicRoll >= 70 && magicRoll < 90 && a.mp >= 7 && b.st <= 5) return act({ type: 'magic', spell: 7 }, true)
    }
    return act({ type: 'attack' }, true)
  }
  return { snapshot, act, auto }
}

/** Rounds count individual alternating actions, not pairs of turns. */
export function battle(left: Fighter, right: Fighter, rng: () => number = Math.random, options: BattleOptions = {}): BattleResult {
  const session = createBattle(left, right, rng, options)
  let result = session.snapshot().result
  while (!result) result = session.auto().result
  return result
}

export const createDuel = createBattle
export function stepDuel(duel: BattleSession, action: BattleAction): BattleSnapshot {
  return duel.act(action)
}
