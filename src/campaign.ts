/**
 * Campaign rules from finalfighter/BarcodeBattler2-Simulator (MIT):
 * C1WorldData.as, C2PassCode.as and barcode2.as.
 *
 * This is a single-active-hero adaptation: C1 automatically visits every enemy
 * in L1..L5 then LH instead of the original world/CPU enemy selection. C2 is
 * open-ended scanned-card training, NOT an invented sequence of worlds.
 * Party switching, post-battle items and interactive magic are not implemented.
 */
import { combineFighters, createBattle, decodeBarcode } from './game.ts'
import type { BattleResult, Fighter } from './game.ts'

export interface Campaign {
  mode: 'C1' | 'C2'
  /** Number of victories, not a made-up C2 world number. */
  stage: number
  hero: Fighter
  baseHero: Fighter
  complete: boolean
  defeated: boolean
  enemyName: string
  /** Original E1..E6 and L1..L5/LH, represented with zero-based indices. */
  chapter: number
  world: number
  enemy: number
  unionCheckdigit: number
  keys: string[]
  enemyBarcode: string
}

// Rows: HP, ST, DF, victory growth, checksum pointer, boss HP recovery.
const c1 = [
  [[21,27,33,40,48,56,64,72,81,91],[7,8,9,11,12,15,16,18,21,23],[9,10,12,14,15,18,20,21,24,27],[1,1,1,1,1,2],[0,0,4,4,3,3,2,2,1,1],[15,18,21,24,27]],
  [[72,81,91,101,111,121,132,144,156,168],[18,21,23,26,28,30,33,35,39,41],[21,24,27,30,31,34,37,39,43,46],[2,2,2,2,2,2],[4,4,3,3,2,2,1,1,0,0],[36,39,42,45,48]],
  [[144,156,168,180,193,207,221,235,249,264],[35,39,41,44,48,51,55,58,61,65],[39,43,46,48,51,55,59,61,65,69],[3,2,3,3,3,2],[4,4,3,3,2,2,1,1,0,0],[57,60,63,66,69]],
  [[235,249,264,280,296,312,328,345,363,381],[58,61,65,68,73,76,80,85,89,94],[61,65,69,72,76,80,83,87,91,96],[3,4,3,3,3,4],[3,3,4,4,0,0,1,1,2,2],[78,81,84,87,90]],
  [[345,363,381,399,417,436,456,476,496,516],[85,89,94,98,102,107,111,117,121,126],[87,91,96,99,103,108,112,117,121,125],[4,4,4,4,4,4],[3,3,4,4,0,0,1,1,2,2],[99,102,105,108,110]],
  [[476,496,516,537,559,581,603,625,648,672],[117,121,126,132,137,143,148,153,159,164],[117,121,125,130,135,141,145,150,155,160],[4,4,4,4,4,4],[2,2,3,3,4,4,0,0,1,1],[120,123,126,129,132]],
]
const keySets = [
  ['L1-1','L3-2','L5-3'],
  ['L2-2','L4-3','L5-1'],
  ['L1-1','L3-2','L5-3'],
  ['L2-1','L3-3','L5-4'],
  ['L1-4','L2-2','L4-3'],
]
const stGrowth = [0,0,0,0,0,1,1,1,2,3,4,4,5,6,7,9,10,11,12,14,16,17,19,21,23,25,27,29,31,33,36,38,40,43,46,49,51,54,57,60,64,67,70,73,77,81,84,88,92,96,100,104,108,112,116,121,125,129,134,139,144,148,153,158,163,169,174,179,184,190,196]
const dfGrowth = [0,0,0,0,0,1,1,2,3,4,5,6,7,8,9,11,12,14,16,18,20,22,24,26,28,31,33,36,39,42,45,48,51,54,57,61,64,68,72,76,80,84,88,92,96,101,105,110,115,120,125,130,135,140,145,151,156,162,168,174,180,186,192,198]
const clearLevels = [10,16,24,31,38,45]
const trainingBarcode = '0401207336501'

function startingKeys(chapter: number, checksum: number): string[] {
  const offset = chapter === 0 ? 0 : chapter <= 2 ? 4 : chapter <= 4 ? 3 : 2
  return [...keySets[(offset - Math.floor(checksum / 2) + 5) % 5]]
}

function enemyName(state: Campaign): string {
  return state.mode === 'C1'
    ? `E-${state.chapter + 1} L-${state.world === 5 ? 'H' : state.world + 1} ${state.enemy === 4 ? 'HH' : `0${state.enemy + 1}`}`
    : state.enemyBarcode === trainingBarcode ? 'ラーメン活武' : decodeBarcode(state.enemyBarcode, { mode: 'C2', hero: false }).name
}

export interface CampaignOptions {
  /** Supplies the original two-hero checksum; this adaptation battles with one active hero. */
  magicianBarcode?: string
  enemyBarcode?: string
  password?: string
}

export function createCampaign(mode: 'C1' | 'C2', heroBarcode: string, supportBarcode?: string, options: CampaignOptions = {}): Campaign {
  if (mode !== 'C1' && mode !== 'C2') throw new Error('Invalid campaign mode')
  const hero = decodeBarcode(heroBarcode, { mode, hero: true })
  if (hero.kind !== 'fighter' || hero.hp <= 0) throw new Error('Campaign requires a living hero')
  if (options.magicianBarcode !== undefined) {
    const partner = decodeBarcode(options.magicianBarcode, { mode, hero: true, job: 'magician' })
    if (partner.kind !== 'fighter' || partner.hp <= 0) throw new Error('Invalid partner hero')
  }
  const unionCheckdigit = (Number(heroBarcode.at(-1)) + Number(options.magicianBarcode?.at(-1) ?? 0)) % 10
  const state: Campaign = {
    mode, stage: 0, hero: { ...hero, maxHp: hero.hp }, baseHero: { ...hero },
    complete: false, defeated: false, enemyName: '', chapter: 0, world: 0,
    enemy: 0, unionCheckdigit, keys: startingKeys(0, unionCheckdigit),
    enemyBarcode: trainingBarcode,
  }
  state.enemyName = enemyName(state)
  let next = options.password ? useCampaignPassword(state, options.password) : state
  if (supportBarcode) next = { ...next, hero: combineFighters(next.hero, decodeBarcode(supportBarcode, { mode, hero: false }), { mode }) }
  if (options.enemyBarcode) next = setCampaignEnemy(next, options.enemyBarcode)
  return next
}

export function campaignEnemy(state: Campaign): Fighter {
  if (state.complete || state.defeated) throw new Error('Campaign is finished')
  if (state.mode === 'C2') {
    return { ...decodeBarcode(state.enemyBarcode, { mode: 'C2', hero: false }), name: state.enemyName }
  }
  const table = c1[state.chapter]
  const pointer = (table[4][state.unionCheckdigit] + state.world) % 5
  const index = state.world === 5 ? 5 + state.enemy : state.enemy + pointer
  const job = [7,2,8,4,5][state.enemy]
  return {
    barcode: '0000000000000', name: enemyName(state), kind: 'fighter',
    hp: table[0][index] * 100, attack: table[1][index] * 100,
    defense: table[2][index] * 100, speed: state.enemy === 4 ? 6 : 5,
    race: [0,1,2,3,4,4][state.world], job, special: 0,
    mp: job > 6 ? 10 : 0, pp: 5, reading: 'pre',
  }
}

/** C2 opponents are scanned, without hero scaling, exactly as in the original. */
export function setCampaignEnemy(state: Campaign, barcode: string): Campaign {
  if (state.mode !== 'C2') throw new Error('C1 enemies come from the world table')
  if (state.complete || state.defeated) throw new Error('Campaign is finished')
  const enemy = decodeBarcode(barcode, { mode: 'C2', hero: false })
  if (enemy.kind !== 'fighter' || enemy.hp <= 0) throw new Error('Enemy must be a living fighter')
  const next = { ...state, enemyBarcode: barcode }
  return { ...next, enemyName: enemyName(next) }
}

function capHero(hero: Fighter): Fighter {
  const hp = Math.min(99900, hero.hp)
  return { ...hero, hp, maxHp: Math.max(hero.maxHp ?? 0, hp),
    attack: Math.min(19900, hero.attack), defense: Math.min(19900, hero.defense),
    mp: Math.min(99, hero.mp), pp: Math.min(99, hero.pp) }
}

function c2Reward(hero: Fighter, special: number): Fighter {
  const next = { ...hero }
  const magician = hero.job > 6
  if (special >= 65 && special <= 69) {
    // Preserve the original's literal +1/+3/+4/+5/+10, despite its UI labels.
    next.hp += [1,3,4,5,10][special - 65] * 100
    next.pp += 5
    if (magician) next.mp += 5
  } else if (special >= 70 && special <= 74) {
    next.attack += (special - 69) * 200
    next.pp += 5
  } else if (special >= 75 && special <= 79) {
    // barcode2.as gives the magician +1, not +10, for special 79.
    next.defense += (special === 79 && magician ? 1 : (special - 74) * 2) * 100
    if (magician) next.mp += 5
  } else {
    next.pp += 5
    if (magician) next.mp += 5
  }
  return capHero(next)
}

/** C2PassCode growth uses the ORIGINAL hero, never compounds a saved hero. */
function passwordHero(base: Fighter, level: number): Fighter {
  const n = level - 1
  if (n < 0) return { ...base, maxHp: base.hp }
  let hpPart = Math.floor(base.hp / 100 * n / 10)
  let quadratic = Math.floor(n / 2) * Math.ceil(n / 2)
  let overflow = 0
  while (hpPart > 655) { hpPart -= 655; overflow = 1 }
  while (quadratic > 655) { quadratic -= 655; overflow = 1 }
  let hp = base.hp / 100 + hpPart + quadratic
  hp = hp > 999 ? 999 : hp - overflow
  if (n >= 90 && n % 2 === 0) hp--
  const attack = Math.min(199, base.attack / 100 + Math.floor(base.attack / 100 * n / 9) + (stGrowth[n] ?? 199))
  const defense = Math.min(199, base.defense / 100 + Math.floor(base.defense / 100 * n / 12) + (dfGrowth[n] ?? 199))
  return { ...base, hp: hp * 100, maxHp: hp * 100, attack: attack * 100, defense: defense * 100 }
}

export function nextCampaignBattle(state: Campaign, rng: () => number = Math.random): { state: Campaign; result: BattleResult } {
  const enemy = campaignEnemy(state)
  const session = createBattle(state.hero, enemy, rng)
  let snapshot = session.snapshot()
  while (!snapshot.result) snapshot = session.auto()
  const result = snapshot.result
  const next: Campaign = { ...state, hero: { ...state.hero, hp: result.leftHp,
    mp: snapshot.left.mp, pp: snapshot.left.pp }, keys: [...state.keys] }
  if (result.winner !== 'left' || result.leftHp <= 0) {
    next.defeated = true
    return { state: next, result }
  }
  next.stage++
  if (state.mode === 'C2') {
    next.hero = c2Reward(next.hero, enemy.special)
    return { state: next, result }
  }
  const table = c1[state.chapter]
  const pointer = (table[4][state.unionCheckdigit] + state.world) % 5
  const growth = table[3][state.world === 5 ? 5 : pointer] * 100
  const key = `L${state.world + 1}-${state.enemy + 1}`
  // Defeating a local boss also collects keys carried by its remaining enemies.
  next.keys = next.keys.filter(value => state.enemy === 4 ? !value.startsWith(`L${state.world + 1}-`) : value !== key)
  if (state.enemy === 4) {
    next.hero.hp += table[5][pointer] * 100
    next.hero.attack += growth
    next.hero.defense += growth
  } else if (enemy.job <= 6) {
    next.hero.attack += growth
    next.hero.pp += 5
  } else {
    next.hero.defense += growth
    if (next.hero.job > 6) next.hero.mp += 5
  }
  next.hero = capHero(next.hero)
  if (state.world === 5 && state.enemy === 4) {
    if (state.chapter >= 3) next.complete = true
    else {
      next.chapter++
      next.world = 0
      next.enemy = 0
      next.keys = startingKeys(next.chapter, next.unionCheckdigit)
      next.hero = passwordHero(next.baseHero, clearLevels[state.chapter])
    }
  } else if (state.enemy === 4) {
    next.world++
    next.enemy = 0
    if (next.world === 5 && next.keys.length) throw new Error('LH requires three keys')
  } else next.enemy++
  next.enemyName = next.complete ? 'CLEAR' : enemyName(next)
  return { state: next, result }
}

/** Original 5-digit C2 password, bound to the selected heroes' checksums. */
export function campaignPassword(state: Campaign, level: number): string {
  if (!Number.isInteger(level) || level < 0 || level > 99) throw new Error('Invalid password level')
  const tens = Math.floor(level / 10), ones = level % 10
  const check = (state.unionCheckdigit + Math.floor(((tens + ones) % 10) / 2)) % 10
  return `${tens}${tens}${ones}${ones}${check}`
}

export function useCampaignPassword(state: Campaign, password: string): Campaign {
  if (state.stage !== 0 || state.defeated || state.complete) throw new Error('Passwords require a new campaign')
  if (state.mode === 'C1') {
    const powerups: Record<string, [number, number, number, number, number, number]> = {
      '815': [1.4,4,13,0,16,0], '031': [1.6,9,15,1,18,1],
      '009': [1.7,12,16,1,19,2], '099': [1.8,16,17,2,20,3],
      '077': [1.9,20,18,3,21,4],
    }
    const powerup = powerups[password]
    if (powerup) {
      const [hpRate,hpBonus,stRate,stBonus,dfRate,dfBonus] = powerup
      const base = state.baseHero
      const hp = (Math.floor(base.hp / 100 * hpRate) + hpBonus) * 100
      return { ...state, hero: { ...base, hp, maxHp: hp,
        attack: (Math.floor(base.attack / 100 * stRate / 9) + stBonus) * 100,
        defense: (Math.floor(base.defense / 100 * dfRate / 12) + dfBonus) * 100 } }
    }
    const chapter = password === `31${(state.unionCheckdigit + 1) % 10}` ? 4
      : password === `38${state.unionCheckdigit}` ? 5 : -1
    if (chapter < 0) throw new Error('Unsupported C1 password')
    const next = { ...state, chapter, hero: passwordHero(state.baseHero, clearLevels[chapter - 1]),
      keys: startingKeys(chapter, state.unionCheckdigit) }
    return { ...next, enemyName: enemyName(next) }
  }
  if (!/^\d{5}$/.test(password)) throw new Error('Invalid C2 password')
  const level = Number(password[0]) * 10 + Number(password[2])
  if (campaignPassword(state, level) !== password) throw new Error('Invalid C2 password')
  return { ...state, hero: passwordHero(state.baseHero, level) }
}
