import './style.css'
import { createBattle, combineFighters, decodeBarcode, jobName, MAGIC_COSTS, RACE_NAMES, type BattleAction, type BattleSession, type Fighter } from './game.ts'
import { campaignEnemy, createCampaign, finishCampaignBattle, selectCampaignWorld, setCampaignEnemy, switchCampaignHero, type Campaign } from './campaign.ts'
import { cameraErrorMessage, interpretScan, requestBarcodeCamera, startBarcodeCamera, type CameraSession } from './scan.ts'

type Product = {
  name: string | null
  thumbnail: string | null
  amazonAffiliateUrl?: string | null
  amazonStandardUrl?: string | null
  amazonLinkType?: 'product' | 'search'
}
type Room = { id: string; name: string; barcodePrefix: string | null; champion: { barcode: string; fighter?: Fighter; wins: number; isOwner?: boolean; product?: Product | null } | null }
type RoomFight = { roomId: string; challenger: Fighter; champion: Fighter | null; winner: Side }
type Side = 'left' | 'right'
type Mode = 'C0' | 'C1' | 'C2'
type Indicator = 'battle' | 'card' | 'escape' | 'critical' | 'power' | 'miss' | 'damage'

const SPELLS = ['F0 MP吸収', 'F1 打撃・小', 'F2 打撃・大', 'F3 回復・小', 'F4 回復・大', 'F5 防御DOWN', 'F6 防御UP', 'F7 攻撃DOWN', 'F8 攻撃UP', 'F9 薬草封じ']
const MODES: Mode[] = ['C0', 'C1', 'C2']
const MODE_NAMES: Record<Mode, string> = { C0: 'フリーバトル', C1: '冒険 C1', C2: '挑戦 C2' }
const SLOT_NAMES: Record<string, string> = { left: '1P', right: '2P', 'left-card': '1P 合体', 'right-card': '2P 合体', enemy: 'C2の敵' }

// Seven-segment glyphs drawn as SVG polygons; no original artwork is used.
const SEGMENTS: Record<string, string> = {
  '0': 'abcdef', '1': 'bc', '2': 'abged', '3': 'abgcd', '4': 'fgbc', '5': 'afgcd',
  '6': 'afgedc', '7': 'abc', '8': 'abcdefg', '9': 'abcdfg', '-': 'g', ' ': '',
}
const horizontal = (x1: number, x2: number, y: number, t = 1.8) =>
  `${x1},${y} ${x1 + t / 2},${y - t / 2} ${x2 - t / 2},${y - t / 2} ${x2},${y} ${x2 - t / 2},${y + t / 2} ${x1 + t / 2},${y + t / 2}`
const vertical = (x: number, y1: number, y2: number, t = 1.8) =>
  `${x},${y1} ${x + t / 2},${y1 + t / 2} ${x + t / 2},${y2 - t / 2} ${x},${y2} ${x - t / 2},${y2 - t / 2} ${x - t / 2},${y1 + t / 2}`
const SEGMENT_SHAPES: Record<string, string> = {
  a: horizontal(1.2, 8.8, 1), g: horizontal(1.2, 8.8, 9), d: horizontal(1.2, 8.8, 17),
  f: vertical(1, 1.2, 8.8), b: vertical(9, 1.2, 8.8), e: vertical(1, 9.2, 16.8), c: vertical(9, 9.2, 16.8),
}
function segments(text: string, digits: number) {
  const chars = text.slice(-digits).padStart(digits, ' ')
  const body = [...chars].map((char, index) => {
    const lit = SEGMENTS[char] ?? ''
    const polys = Object.entries(SEGMENT_SHAPES)
      .map(([name, points]) => `<polygon class="${lit.includes(name) ? 'on' : 'off'}" points="${points}"/>`).join('')
    return `<g transform="translate(${index * 12 + 1.5} 0) skewX(-6)">${polys}</g>`
  }).join('')
  return `<svg class="seg" viewBox="0 0 ${digits * 12 + 1} 18" aria-hidden="true">${body}</svg>`
}
const ICONS = {
  warrior: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 2l3 3-11 11-3 1 1-3zM5 14l5 5-2 2-1.5-1.5L4 22l-2-2 2.5-2.5L3 16z"/></svg>',
  magician: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 1l1.2 3.3L20.5 5l-3.3 1.2L16 9.5l-1.2-3.3L11.5 5l3.3-.7zM13 9l2 2L4 22l-2-2z"/></svg>',
  key: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7a5 5 0 1 1 4.6 7H11l-2 2H7v2H5v2H2v-3l6.4-6.4A5 5 0 0 1 7 7zm5-2a2 2 0 1 0 0 4 2 2 0 0 0 0-4z"/></svg>',
  item: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h16v13H4zM2 5h20v3H2zm9 0h2v16h-2zM12 5C10 1 6 2 7 4.5 8 6 12 5 12 5zm0 0c2-4 6-3 5-.5C16 6 12 5 12 5z"/></svg>',
  info: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3h18v18H3zm8 4v2h2V7zm0 4v6h2v-6z" fill-rule="evenodd"/></svg>',
}
const lcdIcon = (id: string, icon: string, label: string) => `<span class="lcd-icon" id="${id}" title="${label}">${icon}<span class="sr">${label}</span></span>`

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <h1 class="sr">バーコードバトラーII ウェブシミュレータ（非公式）</h1>
  <section class="bb2" aria-label="バーコードバトラーII 本体">
    <div class="body-top">
      <div class="grip grip-l" role="group" aria-label="1P ボタン">
        <button id="l-power" class="pill" type="button" disabled><span class="pill-cap"></span><span class="pill-label">L-POWER</span></button>
        <button id="l-battle" class="pill" type="button" disabled><span class="pill-cap"></span><span class="pill-label">L-BATTLE</span></button>
      </div>
      <div class="face">
        <p class="brandline"><b>BB2</b> CARD BATTLE SYSTEM</p>
        <div class="bezel">
          <i class="vent vent-l" aria-hidden="true"></i>
          <div class="lcd" id="lcd">
            <div class="lcd-row lcd-flags" aria-hidden="true">
              <span class="flag" data-ind="battle">BATTLE</span>
              <span class="flag" data-ind="escape">ESCAPE</span>
              <span class="flag" data-ind="power">POWER</span>
              <span class="flag" data-ind="card">CARD IN</span>
              <span class="flag" data-ind="critical">CRITICAL</span>
              <span class="flag" data-ind="miss">MISS</span>
            </div>
            <div class="lcd-row lcd-icons">
              <span class="icons">${lcdIcon('l-mag', ICONS.magician, '1P 職業: 魔法使い')}${lcdIcon('l-war', ICONS.warrior, '1P 職業: 戦士')}${lcdIcon('ic-key', ICONS.key, '鍵')}${lcdIcon('ic-item', ICONS.item, 'アイテム合体')}</span>
              <span class="lcd-mode" id="lcd-mode">C0</span>
              <span class="icons">${lcdIcon('ic-info', ICONS.info, '情報')}${lcdIcon('r-war', ICONS.warrior, '2P 職業: 戦士')}${lcdIcon('r-mag', ICONS.magician, '2P 職業: 魔法使い')}</span>
            </div>
            <div class="lcd-stats" id="lcd-stats"></div>
            <div id="camera-panel" class="viewfinder" hidden>
              <video id="video" muted playsinline autoplay aria-label="バーコードカメラ"></video>
              <div class="reticle" aria-hidden="true"><span></span><i class="scanline"></i></div>
            </div>
          </div>
          <i class="vent vent-r" aria-hidden="true"></i>
        </div>
        <p id="status" class="message" role="status">カードを読み込んでください</p>
        <div id="room-bar" class="room-bar" hidden>
          <button id="room-prev" type="button" aria-label="前の部屋">◀</button>
          <div class="room-now"><b id="room-name">部屋を読み込み中…</b><span id="room-info"></span></div>
          <button id="room-next" type="button" aria-label="次の部屋">▶</button>
        </div>
        <div class="leds" id="leds" aria-hidden="true">
          <span class="led"></span><span class="led"></span><span class="led"></span><span class="led"></span><span class="led"></span>
        </div>
        <p class="led-caption" aria-hidden="true"><span>L</span><i class="arrow-l"></i><span>BATTLE SIDE</span><i class="arrow-r"></i><span>R</span></p>
      </div>
      <div class="grip grip-r" role="group" aria-label="2P ボタン">
        <button id="r-power" class="pill" type="button" disabled><span class="pill-cap"></span><span class="pill-label">R-POWER</span></button>
        <button id="r-battle" class="pill" type="button" disabled><span class="pill-cap"></span><span class="pill-label">R-BATTLE</span></button>
      </div>
    </div>
    <div class="keys">
      <button id="key-onoff" class="key" type="button"><span class="key-label">ON/OFF</span><span class="key-cap"></span><span class="key-hint">リセット</span></button>
      <button id="key-select" class="key" type="button"><span class="key-label">SELECT</span><span class="key-cap"></span><span class="key-hint" id="select-hint">モード切替</span></button>
      <button id="key-set" class="key" type="button"><span class="key-label">SET</span><span class="key-cap"></span><span class="key-hint" id="set-hint">バトル開始</span></button>
    </div>
    <div class="slot">
      <div class="slot-mouth"><span>CARD IN</span><i class="arrow-r"></i></div>
      <div class="slot-targets" role="group" aria-label="読み込み先">
        <button type="button" data-slot="left" aria-pressed="true">1P</button>
        <button type="button" data-slot="right">2P</button>
        <button type="button" data-slot="left-card">1P 合体</button>
        <button type="button" data-slot="right-card">2P 合体</button>
        <button type="button" data-slot="enemy" hidden>C2の敵</button>
      </div>
      <div class="slot-inputs">
        <button id="camera" class="scan-button" type="button" aria-pressed="false">
          <svg viewBox="0 0 36 24" aria-hidden="true"><path fill="currentColor" d="M1 1h2v22H1zm4 0h1v22H5zm3 0h3v22H8zm5 0h1v22h-1zm3 0h2v22h-2zm4 0h1v22h-1zm3 0h3v22h-3zm5 0h1v22h-1zm3 0h2v22h-2z"/></svg>
          <span id="camera-label">カメラで読む</span>
        </button>
        <form id="scan-form" class="scan-form">
          <label for="barcode" class="sr">バーコード番号（JAN / EAN 8桁・13桁）</label>
          <input id="barcode" name="barcode" inputmode="numeric" maxlength="18" autocomplete="off" enterkeyhint="done" required placeholder="JAN/EAN 8桁・13桁">
          <button type="submit">入力</button>
        </form>
      </div>
      <div class="camera-actions" id="camera-actions" hidden>
        <button id="torch" type="button" hidden aria-pressed="false">ライト</button>
        <button id="stop-camera" type="button">カメラを閉じる</button>
      </div>
      <p class="logo"><span>BARCODE BATTLER</span><em>II</em></p>
    </div>
  </section>

  <section class="console" aria-label="操作パネル">
    <nav class="tabs" aria-label="画面"><button id="local-tab" type="button" aria-pressed="true">ローカル対戦</button><button id="rooms-tab" type="button" aria-pressed="false">勝ち抜き部屋</button></nav>
    <div id="local-controls">
      <div class="modes" role="group" aria-label="ゲームモード">
        <button type="button" data-mode="C0" aria-pressed="true"><b>C0</b>フリー</button>
        <button type="button" data-mode="C1"><b>C1</b>冒険</button>
        <button type="button" data-mode="C2"><b>C2</b>挑戦</button>
      </div>
      <p id="mode-help" class="hint"></p>
      <div id="campaign-setup" class="panel" hidden>
        <div class="field-row">
          <label>C2の敵バーコード（任意）<input id="enemy-barcode" inputmode="numeric" maxlength="18" placeholder="8桁または13桁"></label>
          <label>パスワード（任意）<input id="password" inputmode="numeric" maxlength="5" placeholder="3桁または5桁"></label>
        </div>
      </div>
      <div id="campaign-controls" class="panel" hidden>
        <p id="campaign-status"></p>
        <div class="field-row">
          <button id="switch-hero" type="button">主人公を交代</button>
          <button id="set-enemy" type="button">入力した敵に変更</button>
          <span id="world-controls"><select id="world" aria-label="C1ワールド"><option value="1">L-1</option><option value="2">L-2</option><option value="3">L-3</option><option value="4">L-4</option><option value="5">L-5</option><option value="H">L-H（鍵3個）</option></select><button id="set-world" type="button">ワールド移動</button></span>
        </div>
      </div>
      <div id="battle-actions" class="panel" hidden>
        <p id="turn"></p>
        <div class="field-row">
          <label>攻撃・POWERの強さ<select id="timing"><option value="1">通常</option><option value="2">強打</option></select></label>
          <span class="combo"><select id="herbs" aria-label="薬草の数"><option value="1">薬草1個</option><option value="2">薬草2個</option><option value="3">薬草3個</option></select><button id="heal" type="button">薬草を使う</button></span>
          <span class="combo"><select id="spell" aria-label="魔法">${SPELLS.map((label, index) => `<option value="${index}">${label}（MP ${MAGIC_COSTS[index]}）</option>`).join('')}</select><button id="magic" type="button">魔法を使う</button></span>
        </div>
        <button id="auto" class="ghost" type="button">最後まで自動で戦う</button>
      </div>
      <div class="field-row">
        <button id="sample" class="ghost" type="button">サンプルカードで試す</button>
      </div>
    </div>
    <div id="room-controls" hidden>
      <p class="hint">本体の CARD IN で1Pのカードを読み込み、液晶の下の ◀▶ で部屋を選んで SET（または L-BATTLE）で挑戦します。SELECT を押すとフリーバトルに戻ります。勝者が部屋に残ります。合体・アイテムは使えません。</p>
      <button id="refresh" class="ghost" type="button">部屋を更新</button>
      <div id="rooms"></div>
    </div>
    <div id="cards" class="cards"></div>
    <details class="log-drawer"><summary>バトルログ</summary><ol id="log"></ol></details>
  </section>
  <section class="help"><details><summary>遊び方と注意</summary>
    <p>下の CARD IN で 1P と 2P のカードを読み込み、SET（または L-BATTLE / R-BATTLE）でバトル開始。自分の番に BATTLE で攻撃、POWER で回復します。光っている側のボタンが操作できます。薬草・魔法は操作パネルから使います。</p>
    <p>カードは種族0〜4がキャラカード（機械族・アニマル族・魚族・バード族・ヒューマン族）、5〜9がアイテムカード（武器・防具・HPアップ）です。職業0〜6は戦士、7〜9は魔法使いで、どちらになるかは読み込んだバーコードで決まります。</p>
    <p>SELECT でモードを切り替えます。C1/C2 は 1P に職業が戦士のキャラカード、2P に職業が魔法使いのキャラカード（任意）を読み込んで SET。C2 は SET 後に「C2の敵」へ敵のキャラカードを読み込みます。アイテムカードは直前に読み込んだキャラカードに合体します。</p>
    <p>カメラはHTTPSまたはlocalhostと、ブラウザの許可が必要です。映像は端末の中だけで解析し、サーバーへ送りません。読めないときは数字を入力できます。</p>
    <p>「国内49コード」部屋は49で始まるコード専用です。49は商品の原産国を保証しません。商品名・画像は見つかった場合だけ表示します。逃走と戦闘後アイテムは未対応です。</p>
  </details></section>
  <footer><p>非公式ファンプロジェクト · 原作ゲーム・商標の権利は各権利者に帰属します</p><p id="amazon-disclosure" hidden>Amazonのアソシエイトとして、BarcodeBattler2-Simulator-Webは適格販売により収入を得ています。</p><p>商品データ: <a href="https://world.openfoodfacts.org/" target="_blank" rel="noreferrer">Open Food Facts</a>（ODbL / 画像 CC BY-SA）</p></footer>`

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const slots: { left: Fighter | null; right: Fighter | null } = { left: null, right: null }
const products = new Map<string, Product>()
const combined = new Set<Side>()
const secondCards = new Map<Side, string>()
const heroCards = new Map<Side, string>()
let mode: Mode = 'C0'
let target = 'left'
let campaign: Campaign | null = null
let duel: BattleSession | null = null
let duelOriginal: { left: Fighter; right: Fighter } | null = null
let campaignDuelResolved = false
let guardianStar: 0 | 1 | 2 | undefined
let online = false
let busy = false
let session: Promise<unknown> | undefined
let cameraAbort: AbortController | undefined
let cameraSession: CameraSession | undefined
let torchOn = false
let audio: AudioContext | undefined
let rooms: Room[] = []
let roomIndex = 0
let roomFight: RoomFight | null = null
let lit = new Set<Indicator>()
let litTimer = 0

function status(message: string) { $('status').textContent = message }
function errorMessage(error: unknown) {
  return translate(error instanceof Error ? error.message : '処理に失敗しました')
}
/** Map engine and Worker messages (English) to the Japanese UI copy. */
function translate(raw: string) {
  const known: [string, string][] = [
    ['first champion', 'この部屋の最初の王者になりました！'],
    ['new champion', '勝利！あなたのカードが新しい王者です。'],
    ['defended the room', '王者が防衛しました。別のカードで挑戦してください。'],
    ['requires barcodes beginning', 'この部屋は指定の番号で始まるコード専用です。'],
    ['own champion', '自分の王者には挑戦できません。'],
    ['champion changed', '王者が入れ替わりました。部屋を更新して挑戦し直してください。'],
    ['Too many requests', '操作が多すぎます。1分ほど待ってから試してください。'],
    ['is an item', 'アイテムカードでは挑戦できません。キャラカードを読み込んでください。'],
    ['cannot enter a standalone', 'このコードでは挑戦できません。'],
    ['valid EAN-8 or EAN-13', '8桁または13桁のJAN/EANではありません。チェックデジットも確認してください。'],
    ['Room not found', '部屋が見つかりません。部屋を更新してください。'],
    ['Invalid JAN/EAN', '8桁または13桁のJAN/EANではありません。チェックデジットも確認してください。'],
    ['not a hero', 'このカードは主人公にできません。'],
    ['starting limits', '主人公カードの初期能力が上限を超えています。'],
    ['wrong job', '2Pには職業が魔法使いのキャラカードを読み込んでください。'],
    ['First card must be a fighter', '先にキャラカードを読み込んでください。'],
    ['identical card suffixes', '下7桁が同じカードは合体できません。'],
    ['fusion requires', '冒険・挑戦でキャラカード同士を合体するには、同じ種族・同じ職業のカードが必要です。'],
    ['Information cards', '情報カードは冒険モードだけで使えます。'],
    ['cannot use MP', '職業が戦士のキャラにはMPアップを合体できません。'],
    ['Incompatible equipment', '職業が魔法使いのキャラには武器・防具を合体できません。'],
    ['must be a warrior', 'C1/C2の1Pには職業が戦士のキャラカードを読み込んでください。'],
    ['Invalid partner', '2Pのキャラカードを確認してください。'],
    ['living hero', 'HPが0より大きいキャラカードを読み込んでください。'],
    ['Items cannot battle', 'アイテムカード単体では戦えません。'],
    ['Magic is unavailable', '魔法を使えません。MPが足りないか、職業が戦士のキャラです。'],
    ['Herbs are unavailable', '薬草を使えません。'],
    ['Battle has ended', '戦闘は終わっています。'],
    ['Campaign is finished', 'このシナリオは終了しています。'],
    ['C1 enemies', '冒険モードの敵はワールドで決まります。'],
    ['Enemy must be', '敵にはキャラカードを指定してください。'],
    ['No living reserve', '交代できる主人公がいません。'],
    ['LH requires', 'L-Hには鍵が3個必要です。'],
    ['Finish the current enemy', 'いまの敵を倒してから移動できます。'],
    ['World is cleared', 'このワールドはクリア済みです。'],
    ['Passwords require', 'パスワードは、始めたばかりのシナリオで入力できます。'],
    ['Invalid C2 password', 'C2のパスワードが違います。'],
    ['Unsupported C1 password', 'このC1パスワードには対応していません。'],
    ['Invalid C1 password', 'C1のパスワードが違います。'],
  ]
  for (const [needle, message] of known) if (raw.includes(needle)) return message
  return raw
}
function log(lines: string[]) {
  $('log').replaceChildren(...lines.map(line => {
    const li = document.createElement('li')
    li.textContent = line
    return li
  }))
}
function unlockAudio() {
  try {
    audio ??= new AudioContext()
    void audio.resume()
  } catch { /* Sound is optional. */ }
}
function beep(frequency = 1760, length = 0.08) {
  if (!audio) return
  const now = audio.currentTime
  const osc = audio.createOscillator()
  const gain = audio.createGain()
  osc.type = 'square'
  osc.frequency.setValueAtTime(frequency, now)
  gain.gain.setValueAtTime(0.04, now)
  gain.gain.exponentialRampToValueAtTime(0.0001, now + length)
  osc.connect(gain).connect(audio.destination)
  osc.start(now)
  osc.stop(now + length)
}
/** Light LCD flags briefly, like the handheld does after each action. */
function flashIndicators(next: Indicator[]) {
  window.clearTimeout(litTimer)
  lit = new Set(next)
  if (next.length) litTimer = window.setTimeout(() => { lit.clear(); render() }, 1600)
}
function sweepLeds(from: Side | 'both') {
  const leds = $('leds')
  leds.classList.remove('sweep-lr', 'sweep-rl', 'sweep-both')
  void leds.offsetWidth
  leds.classList.add(from === 'left' ? 'sweep-lr' : from === 'right' ? 'sweep-rl' : 'sweep-both')
}
async function api<T>(path: string, body?: object): Promise<T> {
  const response = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await response.json().catch(() => { throw new Error('通信に失敗しました') })
  if (!response.ok) throw new Error(data.error?.message || '通信に失敗しました')
  return data as T
}
function ensureSession() {
  session ??= api('/api/session').catch(error => { session = undefined; throw error })
  return session
}
function validProductThumbnail(value: string | null | undefined) {
  if (value?.startsWith('/api/images/')) return true
  try {
    const url = new URL(value || '')
    return url.protocol === 'https:' && [
      'm.media-amazon.com',
      'images-fe.ssl-images-amazon.com',
      'images-jp.ssl-images-amazon.com',
      'images-na.ssl-images-amazon.com',
    ].includes(url.hostname)
  } catch {
    return false
  }
}
function appendAmazonLinks(parent: HTMLElement, product: Product | null | undefined) {
  if (!product?.amazonAffiliateUrl || !product.amazonStandardUrl) return
  const links = document.createElement('div')
  links.className = 'product-links'
  const isSearch = product.amazonLinkType === 'search'
  for (const [href, label, affiliate] of [
    [product.amazonAffiliateUrl, isSearch ? 'Amazonでバーコード検索（アフィリエイト）' : 'Amazonで購入（アフィリエイト）', true],
    [product.amazonStandardUrl, isSearch ? 'Amazonでバーコード検索（アフィリエイトなし）' : 'Amazon商品ページ（アフィリエイトなし）', false],
  ] as const) {
    try {
      const url = new URL(href)
      if (url.protocol !== 'https:' || url.hostname !== 'www.amazon.co.jp' ||
        (!/^\/dp\/[A-Z0-9]{10}$/.test(url.pathname) && url.pathname !== '/s')) continue
      const link = document.createElement('a')
      link.href = url.href
      link.textContent = label
      link.target = '_blank'
      link.rel = affiliate ? 'sponsored noreferrer' : 'noreferrer'
      links.append(link)
    } catch { /* Ignore malformed product links. */ }
  }
  if (links.childElementCount) parent.append(links)
}
function battling() { return !!duel && !duel.snapshot().result }
function clearDuel() {
  if (duelOriginal) { slots.left = duelOriginal.left; slots.right = duelOriginal.right }
  duel = null
  duelOriginal = null
}
function readyToFight() {
  return !!slots.left && !!slots.right && !busy && !online && (mode === 'C0' || (!!campaign && !campaign.complete && !campaign.defeated))
}
/** Which side a human currently controls with the grip buttons. */
function controllable(side: Side) {
  if (!duel || online) return false
  const snapshot = duel.snapshot()
  if (snapshot.result || snapshot.turn !== side) return false
  return side === 'left' || !campaign
}

function currentRoom() { return rooms[roomIndex] ?? null }
/** Rooms always use the original single card, as the Worker recomputes it. */
function challenger(): Fighter | null {
  const code = heroCards.get('left')
  return code ? decodeBarcode(code) : null
}
function roomRestriction(room: Room | null, fighter: Fighter | null) {
  if (!room) return '部屋を読み込めていません'
  if (room.champion?.isOwner) return 'あなたが王者です。ほかの部屋に挑戦できます'
  if (fighter && room.barcodePrefix && !fighter.barcode.startsWith(room.barcodePrefix)) return `${room.barcodePrefix}で始まるカードだけ挑戦できます`
  return ''
}
function canChallenge() {
  const room = currentRoom()
  return online && !busy && !!challenger() && !!room && !roomRestriction(room, challenger())
}
type Frame = { left: Fighter | null; right: Fighter | null; lines: string[]; attacker?: Side }
let playback: { frames: Frame[]; index: number; timer: number; finish: () => void } | null = null
function playing() { return !!playback }
function attackerOf(lines: string[]): Side | undefined {
  const match = lines.map(line => /^([12])P (攻撃|MISS|F[12])/.exec(line)).find(Boolean)
  return match ? (match[1] === '1' ? 'left' : 'right') : undefined
}
function showFrame(frame: Frame, last: boolean) {
  flashIndicators(indicatorsFor(frame.lines))
  if (frame.attacker) sweepLeds(frame.attacker)
  const text = summarize(frame.lines)
  if (frame.lines.length) beep(frame.lines.some(line => line.includes('MISS')) ? 440 : frame.lines.some(line => line.includes('CRITICAL')) ? 2200 : 1760)
  if (text && !last) status(`${text}（SETでスキップ）`)
  render()
}
/**
 * Replay a finished battle action by action so it is not just a result.
 * SET (or a tap on the LCD) skips to the end. Resolves once the last frame shows.
 */
function play(frames: Frame[]): Promise<void> {
  skipPlayback()
  if (frames.length === 0) return Promise.resolve()
  return new Promise(resolve => {
    const interval = Math.max(140, Math.min(750, 750 * 30 / frames.length))
    const state = { frames, index: 0, timer: 0, finish: () => {} }
    const step = () => {
      const frame = state.frames[state.index]
      const last = state.index === state.frames.length - 1
      if (last) { state.finish(); return }
      showFrame(frame, false)
      state.index++
      state.timer = window.setTimeout(step, interval)
    }
    state.finish = () => {
      window.clearTimeout(state.timer)
      playback = null
      state.index = state.frames.length - 1
      flashIndicators(indicatorsFor(state.frames[state.index].lines))
      resolve()
    }
    playback = state
    step()
  })
}
function skipPlayback() { playback?.finish() }
$('lcd').addEventListener('click', skipPlayback)

function lcdSides(): { left: Fighter | null; right: Fighter | null } {
  if (playback) { const frame = playback.frames[playback.index]; return { left: frame.left, right: frame.right } }
  if (!online) return slots
  const room = currentRoom()
  if (roomFight && room && roomFight.roomId === room.id) return { left: roomFight.challenger, right: roomFight.champion }
  return { left: challenger(), right: room?.champion?.fighter ?? null }
}

function renderLcd() {
  const sides = lcdSides()
  const value = (fighter: Fighter | null, key: 'hp' | 'attack' | 'defense') => fighter ? String(fighter[key]) : ''
  const rows: [string, string, 'hp' | 'attack' | 'defense'][] = [['HP', 'DAMAGE', 'hp'], ['ST', 'MP', 'attack'], ['DF', 'PP', 'defense']]
  $('lcd-stats').innerHTML = rows.map(([label, small, key]) => `
    <div class="stat-row">
      ${segments(value(sides.left, key), 5)}
      <span class="stat-label"><b>${label}</b><small class="${small === 'DAMAGE' && lit.has('damage') ? 'on' : ''}">${small}</small></span>
      ${segments(value(sides.right, key), 5)}
    </div>`).join('') + `
    <div class="stat-row mini">
      <span class="mini-pair"><small>MP</small>${segments(sides.left ? String(sides.left.mp) : '', 2)}<small>PP</small>${segments(sides.left ? String(sides.left.pp) : '', 2)}</span>
      <span class="hp-bars">${(['left', 'right'] as const).map(side => {
        const fighter = sides[side]
        const max = fighter ? (fighter.maxHp && fighter.maxHp > 0 ? fighter.maxHp : Math.max(fighter.hp, 1)) : 1
        const ratio = fighter ? Math.max(0, Math.min(1, fighter.hp / max)) : 0
        return `<i class="hp-bar ${side}"><i style="width:${(ratio * 100).toFixed(1)}%"></i></i>`
      }).join('')}</span>
      <span class="mini-pair"><small>MP</small>${segments(sides.right ? String(sides.right.mp) : '', 2)}<small>PP</small>${segments(sides.right ? String(sides.right.pp) : '', 2)}</span>
    </div>`
  const waitingCard = online ? !sides.left : (!slots.left || !slots.right) && !duel
  const flags: Record<Indicator, boolean> = {
    battle: online ? !!roomFight || busy : !!duel,
    card: waitingCard || !!cameraSession || !$('camera-panel').hidden,
    escape: false,
    critical: lit.has('critical'),
    power: lit.has('power'),
    miss: lit.has('miss'),
    damage: lit.has('damage'),
  }
  document.querySelectorAll<HTMLElement>('[data-ind]').forEach(flag => {
    flag.classList.toggle('on', flags[flag.dataset.ind as Indicator])
    flag.classList.toggle('blink', flag.dataset.ind === 'card' && waitingCard)
  })
  const job = (side: Side, kind: 'war' | 'mag') => {
    const fighter = sides[side]
    $(`${side === 'left' ? 'l' : 'r'}-${kind}`).classList.toggle('on', !!fighter && (kind === 'mag' ? fighter.job > 6 : fighter.job <= 6))
  }
  job('left', 'war'); job('left', 'mag'); job('right', 'war'); job('right', 'mag')
  $('ic-key').classList.toggle('on', !!campaign && campaign.mode === 'C1' && campaign.keys.length < 3)
  $('ic-item').classList.toggle('on', !online && combined.size > 0)
  $('ic-info').classList.toggle('on', false)
  $('lcd-mode').textContent = online ? 'VS' : mode
}

function renderLeds() {
  const leds = [...$('leds').children] as HTMLElement[]
  const snapshot = duel?.snapshot()
  leds.forEach(led => led.classList.remove('on', 'win'))
  if (online) {
    if (roomFight && roomFight.roomId === currentRoom()?.id) leds[roomFight.winner === 'left' ? 0 : 4].classList.add('on', 'win')
    return
  }
  if (!snapshot) return
  if (snapshot.result) {
    const index = snapshot.result.winner === 'left' ? 0 : 4
    leds[index].classList.add('on', 'win')
  } else leds[snapshot.turn === 'left' ? 0 : 4].classList.add('on')
}

/** The second card's own label (e.g. 武器（使い捨て）, 薬草アップ). */
function secondName(side: Side, race: number) {
  const code = secondCards.get(side)
  try { return code ? decodeBarcode(code).name : RACE_NAMES[race] } catch { return RACE_NAMES[race] }
}
function renderCards() {
  const cards = (['left', 'right'] as const).map(side => {
    const card = document.createElement('article')
    const fighter = slots[side]
    card.className = 'card'
    card.dataset.side = side
    if (target === side || target === `${side}-card`) card.classList.add('targeted')
    const head = document.createElement('h2')
    const who = document.createElement('span')
    who.className = 'who'
    who.textContent = side === 'left' ? (campaign ? '主人公' : '1P') : (campaign ? '敵' : '2P')
    head.append(who, document.createTextNode(fighter ? fighter.name : '未読み込み'))
    if (fighter && combined.has(side)) {
      const badge = document.createElement('span')
      badge.className = 'badge'
      badge.textContent = '合体'
      head.append(badge)
    }
    card.append(head)
    if (!fighter) {
      const empty = document.createElement('p')
      empty.className = 'empty-copy'
      empty.textContent = mode === 'C0' || online ? `CARD IN で${side === 'left' ? '1P' : '2P'}のキャラカードを読み込みます`
        : side === 'left' ? '職業が戦士のキャラカードを読み込みます' : '職業が魔法使いのキャラカード（任意）を読み込みます'
      card.append(empty)
      return card
    }
    const product = products.get(fighter.barcode)
    const body = document.createElement('div')
    body.className = 'card-body'
    if (product?.thumbnail && validProductThumbnail(product.thumbnail)) {
      const image = document.createElement('img')
      image.src = product.thumbnail
      image.alt = product.name || fighter.barcode
      image.className = 'product-image'
      body.append(image)
    }
    const text = document.createElement('div')
    const label = document.createElement('p')
    label.className = 'product-name'
    label.textContent = product?.name || (fighter.barcode === '0000000000000' ? 'シナリオの敵' : fighter.barcode)
    const kind = document.createElement('p')
    kind.className = 'kind'
    const fused = combined.has(side) && fighter.race2 !== undefined
      ? ` + ${fighter.union ? 'キャラ' : 'アイテム'} ${secondName(side, fighter.race2)}` : ''
    kind.textContent = `キャラ 種族${fighter.race} ${RACE_NAMES[fighter.race]} / 職業${fighter.job} ${jobName(fighter.job)}${fused}`
    const stats = document.createElement('p')
    stats.className = 'stats'
    stats.textContent = `HP ${fighter.hp} / ST ${fighter.attack} / DF ${fighter.defense} / 速さ ${fighter.speed} / MP ${fighter.mp} / 薬草 ${fighter.pp}`
    text.append(label, kind, stats)
    body.append(text)
    card.append(body)
    appendAmazonLinks(card, product)
    return card
  })
  $('cards').replaceChildren(...cards)
}

function render() {
  renderLcd()
  renderLeds()
  renderCards()
  const fighting = battling() || playing()
  for (const side of ['left', 'right'] as const) {
    const prefix = side === 'left' ? 'l' : 'r'
    const canAct = !playing() && controllable(side)
    const fighter = duel?.snapshot()[side]
    const herbsBlocked = !!duel?.snapshot().herbsBlocked[side]
    const startable = playing() ? false : online ? side === 'left' && canChallenge() : !fighting && readyToFight() && (side === 'left' || !campaign)
    $<HTMLButtonElement>(`${prefix}-battle`).disabled = !(canAct || startable)
    $<HTMLButtonElement>(`${prefix}-power`).disabled = !canAct || !fighter || fighter.pp === 0 || herbsBlocked
    document.querySelector(`.grip-${prefix}`)!.classList.toggle('active', canAct || startable)
  }
  const setKey = $<HTMLButtonElement>('key-set')
  const needsCampaign = mode !== 'C0' && !campaign
  setKey.disabled = playing() ? false : online ? !canChallenge() : busy || fighting || (needsCampaign ? !slots.left : !readyToFight())
  setKey.classList.toggle('ready', !setKey.disabled)
  $('set-hint').textContent = playing() ? 'スキップ' : online ? '挑戦' : needsCampaign ? 'シナリオ開始' : 'バトル開始'
  $<HTMLButtonElement>('key-select').disabled = busy || fighting
  $('select-hint').textContent = online ? 'フリーへ' : mode === 'C2' ? '勝ち抜きへ' : 'モード切替'
  renderRoomBar()
  $('battle-actions').hidden = !battling() || playing()
  if (battling() && !playing() && duel) {
    const snapshot = duel.snapshot()
    const active = snapshot[snapshot.turn]
    const human = controllable(snapshot.turn)
    $('turn').textContent = `${campaign ? (snapshot.turn === 'left' ? '主人公' : '敵') : snapshot.turn === 'left' ? '1P' : '2P'}の番です`
    $<HTMLButtonElement>('magic').disabled = !human || active.job <= 6
    $<HTMLButtonElement>('heal').disabled = !human || active.pp === 0 || snapshot.herbsBlocked[snapshot.turn]
  }
  document.querySelectorAll<HTMLButtonElement>('[data-slot]').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.slot === target))
    button.hidden = online ? button.dataset.slot !== 'left' : button.dataset.slot === 'enemy' && mode !== 'C2'
  })
  document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.mode === mode))
    button.disabled = fighting
  })
  $('mode-help').textContent = mode === 'C0'
    ? '1Pと2Pのカードを読み込み、SETでバトル開始。両方のプレイヤーが交互に操作します。'
    : mode === 'C1'
      ? '1Pに職業が戦士のキャラカード、2Pに職業が魔法使いのキャラカード（任意）を読み込んでSET。L-1〜L-5の敵と戦い、鍵3個でL-Hが開きます。'
      : '1Pに職業が戦士のキャラカード、2Pに職業が魔法使いのキャラカード（任意）を読み込んでSET。敵のキャラカードは「C2の敵」へ読み込むか下の欄に入力します。'
  $('campaign-setup').hidden = mode === 'C0' || !!campaign
}

function setTarget(value: string) { target = value }
function nextTargetAfter(side: Side, wasCard: boolean) {
  if (online || wasCard) return
  if (side === 'left' && !slots.right) setTarget('right')
  else if (side === 'right' && !slots.left) setTarget('left')
}

async function loadBarcode(barcode: string) {
  skipPlayback()
  try {
    const interpreted = interpretScan(barcode)
    if (!interpreted.ok) {
      status(interpreted.reason === 'checksum'
        ? 'チェックデジットが一致しません。桁と数字を確認してください。'
        : '8桁または13桁のJAN/EANを読み取ってください。')
      beep(220, 0.25)
      return
    }
    if (battling()) throw new Error('バトル中はカードを読み込めません。決着後に読み込んでください。')
    const fighter = decodeBarcode(interpreted.code)
    if (target === 'enemy') {
      if (fighter.kind !== 'fighter') throw new Error('敵にはキャラカードを指定してください')
      $<HTMLInputElement>('enemy-barcode').value = fighter.barcode
      if (campaign?.mode === 'C2') {
        clearDuel()
        campaign = setCampaignEnemy(campaign, fighter.barcode)
        slots.right = campaignEnemy(campaign)
        updateCampaignStatus()
        status(`C2の敵を読み込みました。SETでバトル開始`)
      } else status(`C2の敵を設定しました ${fighter.barcode}`)
      beep()
      render()
      return
    }
    if (online && fighter.kind !== 'fighter') throw new Error('勝ち抜き部屋ではアイテムカードは使えません。キャラカードを読み込んでください。')
    clearDuel()
    let side: Side = target.startsWith('left') ? 'left' : 'right'
    let isCard = target.endsWith('-card')
    if (!isCard && fighter.kind !== 'fighter') {
      // An item is always a second card: equip it to the fighter just read
      // instead of refusing it (1P first, then the item, is the usual order).
      const owner = ([side, side === 'left' ? 'right' : 'left'] as const).find(s => slots[s] && !combined.has(s))
      if (!owner) throw new Error('アイテムカードはキャラカードに合体させるカードです。先にキャラカードを読み込んでください。')
      side = owner
      isCard = true
    }
    if (isCard) {
      const base = slots[side]
      if (!base) throw new Error('先にキャラカードを読み込んでください')
      if (combined.has(side)) throw new Error('合体は1回のみです。キャラカードを読み込み直してください')
      slots[side] = combineFighters(base, fighter)
      combined.add(side)
      secondCards.set(side, fighter.barcode)
    } else {
      slots[side] = fighter
      heroCards.set(side, fighter.barcode)
      combined.delete(side)
      secondCards.delete(side)
    }
    if (campaign) {
      campaign = null
      updateCampaignStatus()
    }
    guardianStar = undefined
    roomFight = null
    nextTargetAfter(side, isCard)
    const loaded = isCard ? `${side === 'left' ? '1P' : '2P'}に${fighter.name}を合体` : `${SLOT_NAMES[side]} ${fighter.name} 読み込み完了`
    const next = online ? (canChallenge() ? ' — SETで挑戦' : ` — ${roomRestriction(currentRoom(), challenger())}`)
      : slots.left && slots.right && mode === 'C0' ? ' — SETでバトル開始' : ''
    status(`${loaded}${next}`)
    flashIndicators([])
    render()
    beep()
    $<HTMLInputElement>('barcode').value = ''
    try {
      await ensureSession()
      const result = await api<{ product: Product | null; amazonAffiliateEnabled: boolean }>(`/api/products/${fighter.barcode}`)
      $('amazon-disclosure').hidden = !result.amazonAffiliateEnabled
      if (result.product) products.set(fighter.barcode, result.product)
      render()
    } catch { /* Product lookup must not prevent local play. */ }
  } catch (error) {
    status(errorMessage(error))
    beep(220, 0.25)
  }
}

function startBattle() {
  if (battling()) return
  try {
    if (mode !== 'C0' && !campaign) { startCampaign(); return }
    if (!slots.left || !slots.right) { status('1Pと2Pのカードを読み込んでください'); return }
    if (!readyToFight()) return
    clearDuel()
    if (campaign) {
      slots.left = campaign.hero
      slots.right = campaignEnemy(campaign)
    }
    duelOriginal = { left: slots.left!, right: slots.right! }
    duel = createBattle(slots.left!, slots.right!, Math.random, { star: campaign?.star ?? guardianStar })
    guardianStar = duel.snapshot().star
    campaignDuelResolved = false
    flashIndicators([])
    sweepLeds('both')
    beep(1320, 0.18)
    if (campaign && duel.snapshot().turn === 'right' && !duel.snapshot().result) {
      // The enemy moves first: show the opening state, then replay its attack.
      const from = duel.snapshot().log.length
      void replayDuel(from, [snapshotFrame(from)], () => duel!.auto())
      return
    }
    showDuel([])
  } catch (error) { status(errorMessage(error)) }
}
function indicatorsFor(lines: string[]): Indicator[] {
  const result: Indicator[] = []
  for (const line of lines) {
    if (line.includes('CRITICAL')) result.push('critical')
    if (line.includes('MISS')) result.push('miss')
    if (line.includes('回復')) result.push('power')
    if (/攻撃 [1-9]/.test(line)) result.push('damage')
  }
  return result
}
function showDuel(newLines: string[]) {
  if (!duel) return
  const snapshot = duel.snapshot()
  slots.left = snapshot.left
  slots.right = snapshot.right
  log(snapshot.log)
  flashIndicators(indicatorsFor(newLines))
  const summary = summarize(newLines)
  if (snapshot.result) {
    const winner = snapshot.result.winner === 'left' ? (campaign ? '主人公' : '1P') : (campaign ? '敵' : '2P')
    status(`${winner} WIN! — ${snapshot.rounds}手で決着`)
    beep(880, 0.35)
  } else {
    const who = snapshot.turn === 'left' ? (campaign ? '主人公' : '1P') : (campaign ? '敵' : '2P')
    const button = snapshot.turn === 'left' ? 'L' : 'R'
    status(`${summary ? `${summary} — ` : `守護星${snapshot.star + 1} `}${who}の番: ${button}-BATTLE で攻撃 / ${button}-POWER で回復`)
  }
  if (snapshot.result && campaign && !campaignDuelResolved) {
    campaign = finishCampaignBattle(campaign, snapshot.result, snapshot)
    campaignDuelResolved = true
    slots.left = campaign.hero
    duelOriginal = null
    if (!campaign.complete && !campaign.defeated) slots.right = campaignEnemy(campaign)
    status(campaign.complete ? 'シナリオクリア！' : campaign.defeated
      ? 'GAME OVER — 主人公を読み直して再挑戦'
      : `${snapshot.result.winner === 'left' ? '勝利！' : '主人公を交代'} SETで次のバトル`)
    updateCampaignStatus()
  }
  render()
}
/** Turn engine log lines ("1P 攻撃 7200", "1P CRITICAL") into one short message. */
function summarize(lines: string[]) {
  const parts: string[] = []
  for (const line of lines) {
    const match = /^([12])P (.+)$/.exec(line)
    if (!match) continue
    const who = campaign ? (match[1] === '1' ? '主人公' : '敵') : `${match[1]}P`
    const text = match[2]
    if (text === 'CRITICAL') { parts[parts.length - 1] += ' CRITICAL!'; continue }
    parts.push(text.startsWith('攻撃 ') ? `${who}の攻撃 ${text.slice(3)}ダメージ`
      : text === 'MISS' ? `${who}の攻撃 MISS`
      : text.startsWith('回復 ') ? `${who} ${text.slice(3)}回復`
      : `${who} ${text}`)
  }
  return parts.join(' / ')
}
function act(action: BattleAction) {
  if (!duel) return
  unlockAudio()
  try {
    const before = duel.snapshot().log.length
    const attacker = duel.snapshot().turn
    duel.act(action)
    if (!campaign || duel.snapshot().turn !== 'right' || duel.snapshot().result) {
      const lines = duel.snapshot().log.slice(before)
      if (action.type === 'attack' || action.type === 'magic') sweepLeds(attacker)
      beep(lines.some(line => line.includes('MISS')) ? 440 : lines.some(line => line.includes('CRITICAL')) ? 2200 : 1760)
      showDuel(lines)
      return
    }
    // The CPU enemy answers right away; replay both actions so its move is visible.
    void replayDuel(before, [snapshotFrame(before)], () => duel!.auto())
  } catch (error) { status(errorMessage(error)) }
}
function snapshotFrame(from: number): Frame {
  const snapshot = duel!.snapshot()
  const lines = snapshot.log.slice(from)
  return { left: snapshot.left, right: snapshot.right, lines, attacker: attackerOf(lines) }
}
/** Run `next` until it stops (or the battle ends), recording a frame per action, then replay them. */
async function replayDuel(from: number, frames: Frame[], next: () => void, untilEnd = false) {
  if (!duel) return
  do {
    const before = duel.snapshot().log.length
    next()
    frames.push(snapshotFrame(before))
  } while (untilEnd && !duel.snapshot().result)
  frames.push({ ...frames[frames.length - 1], lines: [] })
  const session = duel
  await play(frames)
  // ON/OFF or a mode change during the replay discards this battle.
  if (duel === session) showDuel(session.snapshot().log.slice(from).slice(-3))
}
function grip(side: Side, button: 'battle' | 'power') {
  unlockAudio()
  if (playing()) return
  if (online) {
    if (side === 'left' && button === 'battle') void challengeCurrent()
    return
  }
  if (!battling()) {
    if (button === 'battle') startBattle()
    return
  }
  if (!controllable(side)) return
  const strong = $<HTMLSelectElement>('timing').value === '2'
  act(button === 'battle' ? { type: 'attack', timing: strong ? 2 : 1 } : { type: 'power', timing: strong ? 14 : 10 })
}
$('l-battle').addEventListener('click', () => grip('left', 'battle'))
$('l-power').addEventListener('click', () => grip('left', 'power'))
$('r-battle').addEventListener('click', () => grip('right', 'battle'))
$('r-power').addEventListener('click', () => grip('right', 'power'))
$('heal').addEventListener('click', () => act({ type: 'herbs', amount: Number($<HTMLSelectElement>('herbs').value) as 1 | 2 | 3 }))
$('magic').addEventListener('click', () => act({ type: 'magic', spell: Number($<HTMLSelectElement>('spell').value) as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 }))
$('auto').addEventListener('click', () => {
  if (!duel || !battling() || playing()) return
  void replayDuel(duel.snapshot().log.length, [], () => duel!.auto(), true)
})
$('key-set').addEventListener('click', () => {
  unlockAudio()
  if (playing()) skipPlayback()
  else if (online) void challengeCurrent()
  else startBattle()
})

function resetAll(message = 'カードを読み込んでください') {
  stopCamera()
  clearDuel()
  slots.left = slots.right = null
  combined.clear()
  secondCards.clear()
  heroCards.clear()
  campaign = null
  guardianStar = undefined
  updateCampaignStatus()
  flashIndicators([])
  $('log').replaceChildren()
  status(message)
  setTarget('left')
  render()
}
$('key-onoff').addEventListener('click', () => {
  unlockAudio()
  skipPlayback()
  resetAll()
  const lcd = $('lcd')
  lcd.classList.remove('boot')
  void lcd.offsetWidth
  lcd.classList.add('boot')
  beep(990, 0.2)
})
function setMode(next: Mode) {
  if (battling() || playing() || next === mode) return
  clearDuel()
  mode = next
  campaign = null
  guardianStar = undefined
  updateCampaignStatus()
  if (target === 'enemy' && mode !== 'C2') setTarget('left')
  status(`${MODE_NAMES[mode]}（${mode}）${mode === 'C0' ? ' — 1Pと2Pを読み込んでSET' : ' — 1Pに職業が戦士のキャラカードを読み込んでSET'}`)
  beep(1320)
  render()
}
$('key-select').addEventListener('click', () => {
  unlockAudio()
  if (playing()) return
  // SELECT cycles C0 → C1 → C2 → 勝ち抜き部屋 → C0.
  if (online) { setOnline(false); setMode('C0'); return }
  if (mode === 'C2') { setOnline(true); return }
  setMode(MODES[(MODES.indexOf(mode) + 1) % MODES.length])
})
document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(button => {
  button.addEventListener('click', () => setMode((button.dataset.mode || 'C0') as Mode))
})
document.querySelectorAll<HTMLButtonElement>('[data-slot]').forEach(button => {
  button.addEventListener('click', () => {
    setTarget(button.dataset.slot || 'left')
    render()
  })
})
$('scan-form').addEventListener('submit', event => {
  event.preventDefault()
  unlockAudio()
  void loadBarcode($<HTMLInputElement>('barcode').value)
})
$('sample').addEventListener('click', async () => {
  unlockAudio()
  if (battling()) return
  if (mode !== 'C0') setMode('C0')
  setTarget('left')
  await loadBarcode('4901234567894')
  setTarget('right')
  await loadBarcode('96385074')
  status('サンプルの1Pと2Pを読み込みました。SETでバトル開始')
})

function startCampaign() {
  if (!slots.left) { status('先に1Pへ職業が戦士のキャラカードを読み込んでください'); return }
  try {
    const campaignMode = mode as 'C1' | 'C2'
    const rawEnemy = $<HTMLInputElement>('enemy-barcode').value.trim()
    let enemyBarcode: string | undefined
    if (rawEnemy) {
      const enemyCode = interpretScan(rawEnemy)
      if (!enemyCode.ok) throw new Error(enemyCode.reason === 'checksum' ? 'C2の敵: チェックデジットが一致しません' : 'Invalid JAN/EAN')
      enemyBarcode = enemyCode.code
    }
    const password = $<HTMLInputElement>('password').value.trim() || undefined
    const hero = heroCards.get('left') || slots.left.barcode
    const magician = heroCards.get('right')
    let note = ''
    const build = (magicianBarcode?: string) => createCampaign(campaignMode, hero, secondCards.get('left'), { magicianBarcode, enemyBarcode, password })
    try {
      campaign = build(magician)
    } catch (error) {
      // A warrior in 2P is a common mistake; start solo instead of refusing.
      if (!magician || !(error instanceof Error) || !/wrong job|Invalid partner|not a hero/.test(error.message)) throw error
      campaign = build(undefined)
      note = '（2Pのキャラは職業が魔法使いではないため、1人で開始）'
    }
    slots.left = campaign.hero
    slots.right = campaignEnemy(campaign)
    combined.delete('right')
    updateCampaignStatus()
    if (campaignMode === 'C2') setTarget('enemy')
    sweepLeds('both')
    beep(1320, 0.18)
    status(`シナリオ開始${note} — SETでバトル`)
    render()
  } catch (error) { status(errorMessage(error)) }
}
function updateCampaignStatus() {
  $('campaign-controls').hidden = !campaign
  if (!campaign) return
  $('campaign-status').textContent = campaign.mode === 'C1'
    ? `${campaign.enemyName} / 鍵 ${3 - campaign.keys.length}/3 / ${campaign.stage}勝`
    : `C2 / ${campaign.enemyName} / ${campaign.stage}勝`
  $('set-enemy').hidden = campaign.mode !== 'C2'
  $('world-controls').hidden = campaign.mode !== 'C1'
  $<HTMLButtonElement>('switch-hero').disabled = !campaign.partner || campaign.partner.hp <= 0 || campaign.complete || campaign.defeated
  $<HTMLButtonElement>('set-enemy').disabled = campaign.complete || campaign.defeated
}
function campaignChange(change: (state: Campaign) => Campaign, busyMessage: string) {
  if (!campaign || battling()) { status(busyMessage); return }
  try {
    clearDuel()
    campaign = change(campaign)
    slots.left = campaign.hero
    slots.right = campaignEnemy(campaign)
    updateCampaignStatus()
    render()
  } catch (error) { status(errorMessage(error)) }
}
$('switch-hero').addEventListener('click', () => campaignChange(switchCampaignHero, '戦闘中は交代できません'))
$('set-world').addEventListener('click', () => campaignChange(state => {
  const world = $<HTMLSelectElement>('world').value
  return selectCampaignWorld(state, world === 'H' ? 'H' : Number(world) as 1 | 2 | 3 | 4 | 5)
}, '戦闘中は移動できません'))
$('set-enemy').addEventListener('click', () => campaignChange(state => {
  const enemyCode = interpretScan($<HTMLInputElement>('enemy-barcode').value.trim())
  if (!enemyCode.ok) throw new Error(enemyCode.reason === 'checksum' ? 'チェックデジットが一致しません' : 'Invalid JAN/EAN')
  return setCampaignEnemy(state, enemyCode.code)
}, '戦闘中は敵を変更できません'))

function stopCamera() {
  cameraAbort?.abort()
  cameraAbort = undefined
  cameraSession?.stop()
  cameraSession = undefined
  torchOn = false
  const video = $<HTMLVideoElement>('video')
  if (video.srcObject instanceof MediaStream) video.srcObject.getTracks().forEach(track => track.stop())
  video.srcObject = null
  $('camera-panel').hidden = true
  $('camera-actions').hidden = true
  $('torch').hidden = true
  $<HTMLButtonElement>('torch').setAttribute('aria-pressed', 'false')
  $('lcd').classList.remove('scanning')
  $<HTMLButtonElement>('camera').setAttribute('aria-pressed', 'false')
  $('camera-label').textContent = 'カメラで読む'
}
function openCamera() {
  if (cameraAbort) { stopCamera(); status('カメラを閉じました'); render(); return }
  unlockAudio()
  const abort = new AbortController()
  cameraAbort = abort
  $('camera-panel').hidden = false
  $('camera-actions').hidden = false
  $('lcd').classList.add('scanning')
  $<HTMLButtonElement>('camera').setAttribute('aria-pressed', 'true')
  $('camera-label').textContent = `${SLOT_NAMES[target]}へ読み取り中…`
  status('カメラを起動しています…')
  render()
  const streamPromise = requestBarcodeCamera()
  void startBarcodeCamera($<HTMLVideoElement>('video'), streamPromise, {
    signal: abort.signal,
    onStatus: message => { if (!abort.signal.aborted) status(message) },
    onCode: code => {
      stopCamera()
      void loadBarcode(code)
    },
  }).then(session => {
    if (abort.signal.aborted) { session.stop(); return }
    cameraSession = session
    $('torch').hidden = !session.torchAvailable
    if (document.hidden) stopCamera()
  }).catch(error => {
    if (abort.signal.aborted) return
    stopCamera()
    status(cameraErrorMessage(error))
    render()
  })
}
$('camera').addEventListener('click', openCamera)
$('stop-camera').addEventListener('click', () => {
  stopCamera()
  status('カメラを閉じました。数字を入力することもできます。')
  render()
})
$('torch').addEventListener('click', () => {
  if (!cameraSession) return
  torchOn = !torchOn
  void cameraSession.setTorch(torchOn).then(() => {
    $<HTMLButtonElement>('torch').setAttribute('aria-pressed', String(torchOn))
  }).catch(() => {
    torchOn = false
    status('ライトを切り替えられませんでした。')
  })
})
window.addEventListener('pagehide', stopCamera)
document.addEventListener('visibilitychange', () => { if (document.hidden && cameraSession) stopCamera() })

function renderRoomBar() {
  $('room-bar').hidden = !online
  if (!online) return
  const room = currentRoom()
  $<HTMLButtonElement>('room-prev').disabled = busy || rooms.length < 2
  $<HTMLButtonElement>('room-next').disabled = busy || rooms.length < 2
  if (!room) {
    $('room-name').textContent = '部屋を読み込み中…'
    $('room-info').textContent = ''
    return
  }
  $('room-name').textContent = `${room.name}（${roomIndex + 1}/${rooms.length}）`
  const champion = room.champion
  const holder = champion ? `王者 ${champion.product?.name || champion.barcode} ${champion.wins}連勝` : '王者なし — 勝てば王者'
  const restriction = roomRestriction(room, challenger())
  $('room-info').textContent = restriction ? `${holder} / ${restriction}` : `${holder}${room.barcodePrefix ? ` / ${room.barcodePrefix}始まり限定` : ''}`
}
function selectRoom(index: number) {
  if (busy || rooms.length === 0) return
  roomIndex = (index + rooms.length) % rooms.length
  beep(1320)
  render()
  renderRoomList()
}
$('room-prev').addEventListener('click', () => selectRoom(roomIndex - 1))
$('room-next').addEventListener('click', () => selectRoom(roomIndex + 1))
function renderRoomList() {
  $('rooms').replaceChildren(...rooms.map((room, index) => {
    const card = document.createElement('article')
    if (index === roomIndex) card.classList.add('selected')
    const heading = document.createElement('h3')
    heading.textContent = room.name
    const description = document.createElement('p')
    description.textContent = room.champion
      ? `王者: ${room.champion.product?.name || room.champion.barcode} / ${room.champion.wins}連勝`
      : '王者募集中 — 最初の挑戦者が王者になります'
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = index === roomIndex ? '選択中' : 'この部屋を選ぶ'
    button.disabled = busy || index === roomIndex
    button.addEventListener('click', () => {
      selectRoom(index)
      document.querySelector('.bb2')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
    const product = room.champion?.product
    if (product?.thumbnail && validProductThumbnail(product.thumbnail)) {
      const image = document.createElement('img')
      image.src = product.thumbnail
      image.alt = product.name || room.champion!.barcode
      image.className = 'product-image'
      card.append(image)
    }
    const regulation = document.createElement('p')
    regulation.textContent = room.barcodePrefix ? `レギュレーション: ${room.barcodePrefix}で始まるコード` : 'レギュレーション: 無差別'
    card.append(heading, regulation, description)
    appendAmazonLinks(card, product)
    card.append(button)
    return card
  }))
}
async function refreshRooms() {
  try {
    const selected = currentRoom()?.id
    rooms = (await api<{ rooms: Room[] }>('/api/rooms')).rooms
    roomIndex = Math.max(0, rooms.findIndex(room => room.id === selected))
    render()
    renderRoomList()
  } catch (error) { status(`対戦部屋: ${errorMessage(error)}（Cloudflare Workerを起動してください）`) }
}
/** Worker battles put the champion on the left; show the challenger as 1P. */
function fromChampionView(line: string) {
  if (line.includes('claims the empty room')) return '空き部屋に入りました'
  return line.replace(/^([12])P/, (_, n) => n === '1' ? '2P' : '1P')
}
/**
 * Rebuild per-action HP from the Worker log. Start HP is derived backwards from
 * the final HP, so opening debuffs (specials 28/29) still end on the true result.
 */
function roomFrames(lines: string[], challenger: Fighter, champion: Fighter | null, finalHp: { left: number; right: number }): Frame[] {
  const actions: string[][] = []
  for (const line of lines) {
    if (/^[12]P (攻撃|MISS|回復|F\d)/.test(line) || actions.length === 0) actions.push([line])
    else actions[actions.length - 1].push(line)
  }
  const delta = (side: Side, group: string[]) => group.reduce((sum, line) => {
    const hit = /^([12])P 攻撃 (\d+)/.exec(line), heal = /^([12])P 回復 (\d+)/.exec(line)
    const owner = (n: string): Side => n === '1' ? 'left' : 'right'
    if (hit && owner(hit[1]) !== side) return sum - Number(hit[2])
    if (heal && owner(heal[1]) === side) return sum + Number(heal[2])
    return sum
  }, 0)
  const hp = { left: finalHp.left, right: finalHp.right }
  for (const group of actions) { hp.left -= delta('left', group); hp.right -= delta('right', group) }
  const at = (fighter: Fighter | null, value: number, max: number) => fighter && { ...fighter, maxHp: max, hp: Math.max(0, Math.min(max, value)) }
  const maxLeft = Math.max(challenger.hp, hp.left), maxRight = champion ? Math.max(champion.hp, hp.right) : 0
  const frames: Frame[] = []
  for (const group of actions) {
    hp.left += delta('left', group); hp.right += delta('right', group)
    frames.push({ left: at(challenger, hp.left, maxLeft), right: at(champion, hp.right, maxRight), lines: group, attacker: attackerOf(group) })
  }
  frames.push({ left: at(challenger, finalHp.left, maxLeft), right: at(champion, finalHp.right, maxRight), lines: [] })
  return frames
}
async function challengeCurrent() {
  const room = currentRoom()
  const fighter = challenger()
  if (busy || !room) return
  if (!fighter) { status('先にCARD INで1Pのカードを読み込んでください'); return }
  const restriction = roomRestriction(room, fighter)
  if (restriction) { status(restriction); return }
  busy = true
  roomFight = null
  status(`${room.name}に挑戦中…`)
  render()
  renderRoomList()
  void api<{ amazonAffiliateEnabled: boolean }>('/api/config')
    .then(config => { $('amazon-disclosure').hidden = !config.amazonAffiliateEnabled })
    .catch(() => {})
  try {
    await ensureSession()
    const championBefore = room.champion?.fighter ?? null
    const result = await api<{ message: string; battle?: { log: string[]; winner: 'left' | 'right'; leftHp: number; rightHp: number } }>(
      `/api/rooms/${encodeURIComponent(room.id)}/challenge`, { barcode: fighter.barcode })
    const lines = (result.battle?.log || []).map(fromChampionView)
    log(lines)
    if (result.battle && championBefore) {
      status('バトル開始！（SETでスキップ）')
      sweepLeds('both')
      await play(roomFrames(lines, fighter, championBefore, { left: result.battle.rightHp, right: result.battle.leftHp }))
    }
    if (result.battle) {
      roomFight = {
        roomId: room.id,
        challenger: { ...fighter, maxHp: fighter.hp, hp: result.battle.rightHp },
        champion: championBefore ? { ...championBefore, maxHp: championBefore.hp, hp: result.battle.leftHp } : null,
        winner: result.battle.winner === 'right' ? 'left' : 'right',
      }
    }
    beep(roomFight?.winner === 'left' ? 1760 : 440, 0.35)
    status(`${translate(result.message)}${lines.length > 1 ? `（${lines.length - 1}手）` : ''}`)
  } catch (error) { status(errorMessage(error)) }
  finally {
    busy = false
    render()
    const fight = roomFight
    await refreshRooms()
    roomFight = fight
    render()
  }
}
function setOnline(value: boolean) {
  if (battling()) clearDuel()
  online = value
  roomFight = null
  $('local-tab').setAttribute('aria-pressed', String(!value))
  $('rooms-tab').setAttribute('aria-pressed', String(value))
  $('local-controls').hidden = value
  $('room-controls').hidden = !value
  if (value) {
    setTarget('left')
    status(challenger() ? '勝ち抜き部屋: ◀▶で部屋を選び、SETで挑戦' : '勝ち抜き部屋: CARD INで1Pのカードを読み込み、SETで挑戦')
  } else status(`${MODE_NAMES[mode]}（${mode}）`)
  beep(1320)
  render()
  if (value) void refreshRooms()
}
const showUnit = () => document.querySelector('.bb2')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
$('local-tab').addEventListener('click', () => { setOnline(false); showUnit() })
$('rooms-tab').addEventListener('click', () => { setOnline(true); showUnit() })
$('refresh').addEventListener('click', () => void refreshRooms())
render()
