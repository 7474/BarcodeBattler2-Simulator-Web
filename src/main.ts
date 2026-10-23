import './style.css'
import { createBattle, combineFighters, decodeBarcode, MAGIC_COSTS, type BattleAction, type BattleSession, type Fighter } from './game.ts'
import { campaignEnemy, createCampaign, finishCampaignBattle, selectCampaignWorld, setCampaignEnemy, switchCampaignHero, type Campaign } from './campaign.ts'
import { cameraErrorMessage, interpretScan, requestBarcodeCamera, startBarcodeCamera, type CameraSession } from './scan.ts'

type Product = {
  name: string | null
  thumbnail: string | null
  amazonAffiliateUrl?: string | null
  amazonStandardUrl?: string | null
  amazonLinkType?: 'product' | 'search'
}
type Room = { id: string; name: string; barcodePrefix: string | null; champion: { barcode: string; wins: number; isOwner?: boolean; product?: Product | null } | null }
type Side = 'left' | 'right'

const SPELLS = ['F0 MP吸収', 'F1 打撃・小', 'F2 打撃・大', 'F3 回復・小', 'F4 回復・大', 'F5 防御DOWN', 'F6 防御UP', 'F7 攻撃DOWN', 'F8 攻撃UP', 'F9 薬草封じ']

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <section class="unit" aria-label="バーコードバトラーII">
    <header class="mast">
      <div class="logo-block">
        <p class="logo-kicker">JAN / EAN をかざせ</p>
        <h1><span class="logo-en">BARCODE BATTLER</span><span class="logo-ii">II</span><span class="sr">ウェブシミュレータ</span></h1>
        <p class="logo-ja">そのバーコードが、戦士になる。</p>
        <p class="unofficial">非公式ファンプロジェクト</p>
      </div>
      <div class="power"><span id="led" class="led"></span>POWER</div>
    </header>
    <div class="lcd-frame">
      <div class="lcd" id="lcd">
        <div class="lcd-bar">
          <span id="mode-label">フリーバトル</span>
          <p id="status" role="status">カメラか手入力でバーコードを読み取ってください</p>
        </div>
        <div id="camera-panel" class="viewfinder" hidden>
          <video id="video" muted playsinline autoplay aria-label="バーコードカメラ"></video>
          <div class="reticle" aria-hidden="true"><span></span><i class="scanline"></i></div>
          <p class="aim">バーコードを水平に、枠の中へ</p>
          <div class="view-actions">
            <button id="torch" type="button" hidden aria-pressed="false">ライト</button>
            <button id="stop-camera" type="button">カメラを閉じる</button>
          </div>
        </div>
        <div id="fighters" class="fighters"></div>
        <ol id="lcd-log" class="lcd-log"></ol>
      </div>
    </div>
    <div class="deck">
      <nav class="switch" aria-label="画面"><button id="local-tab" type="button" aria-pressed="true">ローカル対戦</button><button id="rooms-tab" type="button" aria-pressed="false">勝ち抜き部屋</button></nav>
      <div class="switch slots" role="group" aria-label="読み込み先">
        <button type="button" data-slot="left" aria-pressed="true">1P 戦士</button>
        <button type="button" data-slot="right">2P 戦士</button>
        <button type="button" data-slot="left-card">1P カード</button>
        <button type="button" data-slot="right-card">2P カード</button>
        <button type="button" data-slot="enemy">C2 の敵</button>
      </div>
      <select id="slot" hidden aria-hidden="true" tabindex="-1"><option value="left">1P 戦士</option><option value="right">2P 戦士</option><option value="left-card">1P カード</option><option value="right-card">2P カード</option><option value="enemy">C2 の敵</option></select>
      <p id="slot-hint" class="hint">光っている枠に読み込みます。1Pの次は自動で2Pです。</p>
      <div class="scan-slot">
        <button id="camera" class="scan-button" type="button" aria-pressed="false">
          <svg class="scan-icon" viewBox="0 0 36 24" aria-hidden="true"><path fill="currentColor" d="M1 1h2v22H1zm4 0h1v22H5zm3 0h3v22H8zm5 0h1v22h-1zm3 0h2v22h-2zm4 0h1v22h-1zm3 0h3v22h-3zm5 0h1v22h-1zm3 0h2v22h-2z"/></svg>
          <span id="camera-label">カメラで読む</span>
        </button>
        <form id="scan-form" class="scan-form">
          <label for="barcode">手入力（JAN / EAN 8桁・13桁）</label>
          <div class="input-row"><input id="barcode" name="barcode" inputmode="numeric" maxlength="18" autocomplete="off" enterkeyhint="done" required placeholder="例: 4901234567894"><button type="submit">読み込む</button></div>
        </form>
      </div>
      <div id="local-controls">
        <div class="switch" role="group" aria-label="ゲームモード">
          <button type="button" data-mode="C0" aria-pressed="true">フリーバトル</button>
          <button type="button" data-mode="C1">冒険 C1</button>
          <button type="button" data-mode="C2">挑戦 C2</button>
        </div>
        <select id="game-mode" hidden aria-hidden="true" tabindex="-1"><option value="C0">C0</option><option value="C1">C1</option><option value="C2">C2</option></select>
        <div id="campaign-setup" class="panel" hidden>
          <p>1Pに戦士の主人公、2Pに魔法使いを読みます。魔法使いはいなくても開始できます。C2の敵は「C2 の敵」でも読めます。</p>
          <label for="enemy-barcode">C2の敵バーコード</label>
          <input id="enemy-barcode" inputmode="numeric" maxlength="18" placeholder="8桁または13桁">
          <label for="password">パスワード（任意、3桁または5桁）</label>
          <input id="password" inputmode="numeric" maxlength="5" placeholder="3桁または5桁">
          <button id="start-campaign" type="button">このメンバーで開始</button>
        </div>
        <p id="campaign-status" hidden></p>
        <div id="campaign-controls" class="campaign-row" hidden>
          <button id="switch-hero" type="button">主人公を交代</button>
          <button id="set-enemy" type="button">C2の敵を設定</button>
          <span id="world-controls"><label for="world">ワールド</label><select id="world" aria-label="C1ワールド"><option value="1">L-1</option><option value="2">L-2</option><option value="3">L-3</option><option value="4">L-4</option><option value="5">L-5</option><option value="H">L-H（鍵3個）</option></select><button id="set-world" type="button">移動</button></span>
        </div>
        <div class="battle-row">
          <button id="fight" class="primary" type="button" disabled>BATTLE</button>
          <button id="reset" class="ghost" type="button">リセット</button>
          <button id="sample" class="ghost" type="button">サンプルで対戦</button>
        </div>
        <div id="battle-actions" hidden>
          <p id="turn"></p>
          <div class="commands">
            <button id="attack" type="button">攻撃</button>
            <button id="power" type="button">POWER</button>
            <button id="heal" type="button">薬草</button>
            <button id="magic" type="button">魔法</button>
          </div>
          <div class="options">
            <label>タイミング<select id="timing"><option value="1">通常</option><option value="2">強打</option></select></label>
            <label>薬草の数<select id="herbs" aria-label="薬草の数"><option value="1">1個</option><option value="2">2個</option><option value="3">3個</option></select></label>
            <label>魔法<select id="spell" aria-label="魔法">${SPELLS.map((label, index) => `<option value="${index}">${label}（MP ${MAGIC_COSTS[index]}）</option>`).join('')}</select></label>
          </div>
        </div>
      </div>
      <div id="room-controls" hidden>
        <p class="hint">1Pに読み込んだ戦士で挑戦します。勝者が部屋に残り、次の挑戦を待ちます。合体カードは使えません。</p>
        <button id="refresh" type="button">部屋を更新</button>
        <div id="rooms"></div>
      </div>
      <details class="log-drawer"><summary>バトルログ</summary><ol id="log"></ol></details>
    </div>
  </section>
  <section class="help"><details><summary>遊び方と注意</summary>
    <p>1Pと2Pを読み込んでBATTLE。フリーバトルでは両方のコマンドを交互に選びます。「1P カード」「2P カード」で2枚目を合体できます。勝ち抜き部屋は1Pの元の1枚だけを使います。</p>
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

function status(message: string) { $('status').textContent = message }
function errorMessage(error: unknown) {
  const raw = error instanceof Error ? error.message : '処理に失敗しました'
  const known: [string, string][] = [
    ['Invalid JAN/EAN', '8桁または13桁のJAN/EANではありません。チェックデジットも確認してください。'],
    ['not a hero', 'このカードは主人公にできません。'],
    ['starting limits', '主人公カードの初期能力が上限を超えています。'],
    ['wrong job', '戦士と魔法使いのカードが逆です。'],
    ['First card must be a fighter', '先に戦士のカードを読み込んでください。'],
    ['identical card suffixes', '下7桁が同じカードは合体できません。'],
    ['fusion requires', '冒険・挑戦の合体には、同じ種族と職業のカードが必要です。'],
    ['Information cards', '情報カードは冒険モードだけで使えます。'],
    ['cannot use MP', '戦士はMPアイテムを使えません。'],
    ['Incompatible equipment', 'この装備は合体できません。'],
    ['must be a warrior', '1Pの主人公は戦士にしてください。'],
    ['Invalid partner', '魔法使いのカードを確認してください。'],
    ['living hero', '戦える主人公カードを読み込んでください。'],
    ['Items cannot battle', 'アイテム単体では戦えません。'],
    ['Magic is unavailable', '魔法を使えません。MPが足りないか、このカードは戦士です。'],
    ['Herbs are unavailable', '薬草を使えません。'],
    ['Battle has ended', '戦闘は終わっています。'],
    ['Campaign is finished', 'このシナリオは終了しています。'],
    ['C1 enemies', '冒険モードの敵はワールドで決まります。'],
    ['Enemy must be', '敵にはキャラクターのコードを指定してください。'],
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
  const items = lines.map(line => {
    const li = document.createElement('li')
    li.textContent = line
    return li
  })
  $('log').replaceChildren(...items)
  $('lcd-log').replaceChildren(...lines.slice(-4).map(line => {
    const li = document.createElement('li')
    li.textContent = line
    return li
  }))
}
function flashLcd() {
  const lcd = $('lcd')
  lcd.classList.remove('flash')
  void lcd.offsetWidth
  lcd.classList.add('flash')
}
function unlockAudio() {
  try {
    audio ??= new AudioContext()
    void audio.resume()
  } catch { /* Sound is optional. */ }
}
function beep() {
  if (!audio) return
  const now = audio.currentTime
  const osc = audio.createOscillator()
  const gain = audio.createGain()
  osc.type = 'square'
  osc.frequency.setValueAtTime(1760, now)
  gain.gain.setValueAtTime(0.04, now)
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.08)
  osc.connect(gain).connect(audio.destination)
  osc.start(now)
  osc.stop(now + 0.08)
}
function setSlot(value: string) {
  $<HTMLSelectElement>('slot').value = value
}
function syncSwitches() {
  const slot = $<HTMLSelectElement>('slot').value
  const mode = $<HTMLSelectElement>('game-mode').value
  document.querySelectorAll<HTMLButtonElement>('[data-slot]').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.slot === slot))
    button.disabled = online && button.dataset.slot !== 'left'
  })
  document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.mode === mode))
  })
  const names: Record<string, string> = { C0: 'フリーバトル', C1: '冒険 C1', C2: '挑戦 C2' }
  let label = online ? '勝ち抜き部屋' : names[mode] ?? 'フリーバトル'
  if (duel) label += ` / 守護星${duel.snapshot().star + 1}`
  $('mode-label').textContent = label
  $('slot-hint').textContent = online
    ? '勝ち抜き部屋は1Pの戦士だけを使います。'
    : slot === 'enemy' ? '次に読んだコードをC2の敵にします。'
    : slot.endsWith('-card') ? 'いま光っている側へ、2枚目のカードを読み込みます。'
    : '光っている枠に読み込みます。1Pの次は自動で2Pです。'
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
function clearDuel() {
  if (duelOriginal) { slots.left = duelOriginal.left; slots.right = duelOriginal.right }
  duel = null
  duelOriginal = null
  $('battle-actions').hidden = true
}
function meter(current: number, max: number) {
  const bar = document.createElement('div')
  bar.className = 'hp'
  const fill = document.createElement('span')
  const ratio = max > 0 ? Math.max(0, Math.min(1, current / max)) : 0
  fill.style.width = `${ratio * 100}%`
  bar.append(fill)
  return { bar, ratio }
}
function render() {
  const selected = $<HTMLSelectElement>('slot').value
  const turn = duel && !duel.snapshot().result ? duel.snapshot().turn : undefined
  const cards = (['left', 'right'] as const).map(side => {
    const card = document.createElement('article')
    const fighter = slots[side]
    card.className = 'fighter'
    card.dataset.side = side
    if (fighter) card.dataset.race = String(fighter.race)
    if (turn === side) card.classList.add('active')
    if (selected === side || selected === `${side}-card`) card.classList.add('targeted')
    const head = document.createElement('div')
    head.className = 'fighter-head'
    const heading = document.createElement('h2')
    const who = document.createElement('span')
    who.className = 'who'
    who.textContent = side === 'left' ? '1P' : '2P'
    heading.append(who, document.createTextNode(fighter ? fighter.name : '待機中'))
    if (fighter && combined.has(side)) {
      const badge = document.createElement('span')
      badge.className = 'badge'
      badge.textContent = '合体'
      heading.append(badge)
    }
    head.append(heading)
    if (fighter) {
      const product = products.get(fighter.barcode)
      if (product?.thumbnail && validProductThumbnail(product.thumbnail)) {
        const image = document.createElement('img')
        image.src = product.thumbnail
        image.alt = product.name || fighter.barcode
        image.className = 'product-image'
        head.append(image)
      }
      card.append(head)
      const label = document.createElement('p')
      label.className = product?.name ? 'product-name' : 'code'
      label.textContent = product?.name || fighter.barcode
      card.append(label)
      appendAmazonLinks(card, product)
      const max = fighter.maxHp && fighter.maxHp > 0 ? fighter.maxHp : Math.max(fighter.hp, 1)
      const { bar, ratio } = meter(fighter.hp, max)
      if (ratio < 0.3) card.classList.add('low')
      if (fighter.hp <= 0) card.classList.add('defeated')
      const hp = document.createElement('p')
      hp.className = 'hp-num'
      hp.textContent = `HP ${fighter.hp.toLocaleString('ja-JP')}`
      const stats = document.createElement('p')
      stats.className = 'stats'
      stats.textContent = `攻 ${fighter.attack.toLocaleString('ja-JP')}  守 ${fighter.defense.toLocaleString('ja-JP')}  速 ${fighter.speed}  MP ${fighter.mp}  薬草 ${fighter.pp}`
      card.append(bar, hp, stats)
    } else {
      card.append(head)
      const ghost = document.createElement('div')
      ghost.className = 'ghost-code'
      ghost.setAttribute('aria-hidden', 'true')
      for (let index = 0; index < 9; index++) ghost.append(document.createElement('i'))
      const empty = document.createElement('p')
      empty.className = 'empty-copy'
      empty.textContent = side === 'left' ? 'バーコード待ち' : '対戦相手を待っています'
      card.append(ghost, empty)
    }
    return card
  })
  const versus = document.createElement('div')
  versus.className = 'vs'
  versus.textContent = 'VS'
  $('fighters').replaceChildren(cards[0], versus, cards[1])
  const mode = $<HTMLSelectElement>('game-mode').value
  const fight = $<HTMLButtonElement>('fight')
  fight.disabled = !slots.left || !slots.right || busy || (mode !== 'C0' && (!campaign || campaign.complete || campaign.defeated))
  fight.textContent = duel && !duel.snapshot().result ? '最後まで' : 'BATTLE'
  fight.title = !slots.left || !slots.right ? '1Pと2Pの戦士を読み込んでください'
    : mode !== 'C0' && !campaign ? '先に「このメンバーで開始」を押してください'
    : campaign?.complete ? 'シナリオクリア済みです'
    : campaign?.defeated ? 'GAME OVERです。主人公を読み直してください'
    : ''
  syncSwitches()
}
async function loadBarcode(barcode: string) {
  try {
    const interpreted = interpretScan(barcode)
    if (!interpreted.ok) {
      status(interpreted.reason === 'checksum'
        ? 'チェックデジットが一致しません。桁と数字を確認してください。'
        : '8桁または13桁のJAN/EANを読み取ってください。')
      return
    }
    const fighter = decodeBarcode(interpreted.code)
    const target = $<HTMLSelectElement>('slot').value
    if (target === 'enemy') {
      if (fighter.kind !== 'fighter') throw new Error('敵にはキャラクターのコードを指定してください')
      $<HTMLInputElement>('enemy-barcode').value = fighter.barcode
      if (campaign?.mode === 'C2' && (!duel || duel.snapshot().result)) {
        campaign = setCampaignEnemy(campaign, fighter.barcode)
        slots.right = campaignEnemy(campaign)
        updateCampaignStatus()
        render()
      }
      status(`C2の敵を読み込みました ${fighter.barcode}`)
      beep()
      flashLcd()
      return
    }
    clearDuel()
    const side: Side = target.startsWith('left') ? 'left' : 'right'
    if (target.endsWith('-card')) {
      if (online) throw new Error('対戦部屋では元の1枚のみを使います')
      if (!slots[side]) throw new Error('先に戦士を読み込んでください')
      if (combined.has(side)) throw new Error('2枚目は1回のみです。戦士を再読込してください')
      slots[side] = combineFighters(slots[side], fighter)
      combined.add(side)
      secondCards.set(side, fighter.barcode)
    } else {
      if (fighter.race > 4) throw new Error('このコードはアイテムです。先に戦士を読み込んでください')
      slots[side] = fighter
      heroCards.set(side, fighter.barcode)
      combined.delete(side)
      secondCards.delete(side)
    }
    if (campaign) {
      campaign = null
      $('campaign-status').hidden = true
      $('campaign-controls').hidden = true
    }
    status(`${side === 'left' ? '1P' : '2P'} 読み込み完了`)
    if (side === 'left' && !target.endsWith('-card') && !online) setSlot('right')
    render()
    beep()
    flashLcd()
    $<HTMLInputElement>('barcode').value = fighter.barcode
    try {
      await ensureSession()
      const result = await api<{ product: Product | null; amazonAffiliateEnabled: boolean }>(`/api/products/${fighter.barcode}`)
      $('amazon-disclosure').hidden = !result.amazonAffiliateEnabled
      if (result.product) products.set(fighter.barcode, result.product)
      render()
    } catch { /* Product lookup must not prevent local play. */ }
  } catch (error) { status(errorMessage(error)) }
}
$('scan-form').addEventListener('submit', event => {
  event.preventDefault()
  unlockAudio()
  void loadBarcode($<HTMLInputElement>('barcode').value)
})
$('sample').addEventListener('click', async () => {
  unlockAudio()
  setSlot('left')
  await loadBarcode('4901234567894')
  setSlot('right')
  await loadBarcode('96385074')
  status('サンプルの1Pと2Pを読み込みました。BATTLEで開始できます。')
})
document.querySelectorAll<HTMLButtonElement>('[data-slot]').forEach(button => {
  button.addEventListener('click', () => {
    setSlot(button.dataset.slot || 'left')
    render()
  })
})
document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(button => {
  button.addEventListener('click', () => {
    const select = $<HTMLSelectElement>('game-mode')
    const next = button.dataset.mode || 'C0'
    if (select.value === next) return
    select.value = next
    select.dispatchEvent(new Event('change'))
  })
})
$('fight').addEventListener('click', () => {
  if (!slots.left || !slots.right) return
  try {
    if (duel && !duel.snapshot().result) {
      while (!duel.snapshot().result) duel.auto()
    } else {
      clearDuel()
      if (campaign) {
        slots.left = campaign.hero
        slots.right = campaignEnemy(campaign)
      }
      duelOriginal = { left: slots.left!, right: slots.right! }
      duel = createBattle(slots.left!, slots.right!, Math.random, { star: campaign?.star ?? guardianStar })
      guardianStar = duel.snapshot().star
      campaignDuelResolved = false
      if (campaign && duel.snapshot().turn === 'right' && !duel.snapshot().result) duel.auto()
    }
    showDuel()
  } catch (error) { status(errorMessage(error)) }
})
function showDuel() {
  if (!duel) return
  const snapshot = duel.snapshot()
  slots.left = snapshot.left
  slots.right = snapshot.right
  log(snapshot.log)
  $('battle-actions').hidden = !!snapshot.result
  $('turn').textContent = campaign
    ? `${snapshot.turn === 'left' ? '主人公' : '敵'}のターン`
    : `${snapshot.turn === 'left' ? '1P' : '2P'}のターン。下のコマンドを選んでください`
  const active = snapshot[snapshot.turn]
  $<HTMLButtonElement>('magic').disabled = active.job <= 6
  $<HTMLButtonElement>('heal').disabled = active.pp === 0 || snapshot.herbsBlocked[snapshot.turn]
  $<HTMLButtonElement>('power').disabled = active.pp === 0 || snapshot.herbsBlocked[snapshot.turn]
  status(snapshot.result
    ? `${snapshot.result.winner === 'left' ? '1P' : '2P'} WIN! — ${snapshot.rounds}ターン`
    : `${snapshot.turn === 'left' ? '1P' : '2P'} のコマンドを選んでください`)
  if (snapshot.result && campaign && !campaignDuelResolved) {
    campaign = finishCampaignBattle(campaign, snapshot.result, snapshot)
    campaignDuelResolved = true
    slots.left = campaign.hero
    if (!campaign.complete && !campaign.defeated) slots.right = campaignEnemy(campaign)
    status(campaign.complete ? 'シナリオクリア！' : campaign.defeated
      ? 'GAME OVER — 主人公を読み直して再挑戦'
      : `${snapshot.result.winner === 'left' ? '勝利！' : '主人公を交代'} 次の戦闘を開始できます`)
    updateCampaignStatus()
  }
  render()
}
function act(action: BattleAction) {
  if (!duel) return
  try {
    duel.act(action)
    if (campaign && duel.snapshot().turn === 'right' && !duel.snapshot().result) duel.auto()
    showDuel()
  }
  catch (error) { status(errorMessage(error)) }
}
$('attack').addEventListener('click', () => act({ type: 'attack', timing: Number($<HTMLSelectElement>('timing').value) as 1 | 2 }))
$('power').addEventListener('click', () => act({ type: 'power', timing: $<HTMLSelectElement>('timing').value === '2' ? 14 : 10 }))
$('heal').addEventListener('click', () => act({ type: 'herbs', amount: Number($<HTMLSelectElement>('herbs').value) as 1 | 2 | 3 }))
$('magic').addEventListener('click', () => act({ type: 'magic', spell: Number($<HTMLSelectElement>('spell').value) as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 }))
$('reset').addEventListener('click', () => {
  clearDuel()
  slots.left = slots.right = null
  combined.clear()
  secondCards.clear()
  heroCards.clear()
  campaign = null
  guardianStar = undefined
  $('campaign-status').hidden = true
  $('campaign-controls').hidden = true
  $('log').replaceChildren()
  $('lcd-log').replaceChildren()
  status('カメラか手入力でバーコードを読み取ってください')
  setSlot('left')
  render()
})
$('game-mode').addEventListener('change', () => {
  clearDuel()
  campaign = null
  guardianStar = undefined
  $('campaign-status').hidden = true
  $('campaign-controls').hidden = true
  const mode = $<HTMLSelectElement>('game-mode').value
  $('start-campaign').hidden = mode === 'C0'
  $('campaign-setup').hidden = mode === 'C0'
  status(mode === 'C0'
    ? '1Pと2Pを読み込み、BATTLEを押してください'
    : '主人公の戦士・魔法使いを読み込み、開始を押してください')
  render()
})
$('start-campaign').addEventListener('click', () => {
  if (!slots.left) { status('先に1Pの主人公を読み込んでください'); return }
  try {
    const mode = $<HTMLSelectElement>('game-mode').value as 'C1' | 'C2'
    const rawEnemy = $<HTMLInputElement>('enemy-barcode').value.trim()
    let enemyBarcode: string | undefined
    if (rawEnemy) {
      const enemyCode = interpretScan(rawEnemy)
      if (!enemyCode.ok) throw new Error(enemyCode.reason === 'checksum' ? 'チェックデジットが一致しません' : 'Invalid JAN/EAN')
      enemyBarcode = enemyCode.code
    }
    campaign = createCampaign(mode, heroCards.get('left') || slots.left.barcode, secondCards.get('left'), {
      magicianBarcode: heroCards.get('right'),
      enemyBarcode,
      password: $<HTMLInputElement>('password').value.trim() || undefined,
    })
    slots.left = campaign.hero
    slots.right = campaignEnemy(campaign)
    updateCampaignStatus()
    status('シナリオ開始 — BATTLEで次の戦闘へ')
    render()
  } catch (error) { status(errorMessage(error)) }
})
function updateCampaignStatus() {
  $('campaign-status').hidden = !campaign
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
$('switch-hero').addEventListener('click', () => {
  if (!campaign || (duel && !duel.snapshot().result)) { status('戦闘中は交代できません'); return }
  try {
    clearDuel()
    campaign = switchCampaignHero(campaign)
    slots.left = campaign.hero
    slots.right = campaignEnemy(campaign)
    updateCampaignStatus()
    render()
  } catch (error) { status(errorMessage(error)) }
})
$('set-world').addEventListener('click', () => {
  if (!campaign || (duel && !duel.snapshot().result)) { status('戦闘中は移動できません'); return }
  try {
    clearDuel()
    const world = $<HTMLSelectElement>('world').value
    campaign = selectCampaignWorld(campaign, world === 'H' ? 'H' : Number(world) as 1 | 2 | 3 | 4 | 5)
    slots.left = campaign.hero
    slots.right = campaignEnemy(campaign)
    updateCampaignStatus()
    render()
  } catch (error) { status(errorMessage(error)) }
})
$('set-enemy').addEventListener('click', () => {
  if (!campaign || (duel && !duel.snapshot().result)) { status('戦闘中は敵を変更できません'); return }
  try {
    clearDuel()
    const enemyCode = interpretScan($<HTMLInputElement>('enemy-barcode').value.trim())
    if (!enemyCode.ok) throw new Error(enemyCode.reason === 'checksum' ? 'チェックデジットが一致しません' : 'Invalid JAN/EAN')
    campaign = setCampaignEnemy(campaign, enemyCode.code)
    slots.left = campaign.hero
    slots.right = campaignEnemy(campaign)
    updateCampaignStatus()
    render()
  } catch (error) { status(errorMessage(error)) }
})
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
  $('torch').hidden = true
  $<HTMLButtonElement>('torch').setAttribute('aria-pressed', 'false')
  $('lcd').classList.remove('scanning')
  $('led').classList.remove('live')
  $<HTMLButtonElement>('camera').setAttribute('aria-pressed', 'false')
  $('camera-label').textContent = 'カメラで読む'
}
function openCamera() {
  stopCamera()
  unlockAudio()
  const abort = new AbortController()
  cameraAbort = abort
  $('camera-panel').hidden = false
  $('lcd').classList.add('scanning')
  $('led').classList.add('live')
  $<HTMLButtonElement>('camera').setAttribute('aria-pressed', 'true')
  $('camera-label').textContent = '読み取り中…'
  status('カメラを起動しています…')
  const streamPromise = requestBarcodeCamera()
  void startBarcodeCamera($<HTMLVideoElement>('video'), streamPromise, {
    signal: abort.signal,
    onStatus: message => { if (!abort.signal.aborted) status(message) },
    onCode: code => {
      stopCamera()
      $<HTMLInputElement>('barcode').value = code
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
  })
}
$('camera').addEventListener('click', openCamera)
$('stop-camera').addEventListener('click', () => {
  stopCamera()
  status('カメラを閉じました。数字を入力することもできます。')
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

async function refreshRooms() {
  try {
    const { rooms } = await api<{ rooms: Room[] }>('/api/rooms')
    $('rooms').replaceChildren(...rooms.map(room => {
      const card = document.createElement('article')
      const heading = document.createElement('h3')
      heading.textContent = room.name
      const description = document.createElement('p')
      description.textContent = room.champion
        ? `王者: ${room.champion.product?.name || room.champion.barcode} / ${room.champion.wins}連勝`
        : '王者募集中 — 最初の挑戦者が王者になります'
      const button = document.createElement('button')
      button.type = 'button'
      button.textContent = room.champion?.isOwner ? 'あなたが現在の王者です' : 'この部屋に挑戦'
      button.disabled = busy || !!room.champion?.isOwner
      button.addEventListener('click', () => void challenge(room.id))
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
  } catch (error) { status(`対戦部屋: ${errorMessage(error)}（Cloudflare Workerを起動してください）`) }
}
async function challenge(id: string) {
  if (busy) return
  if (!slots.left) { status('先に1Pのバーコードを読み込んでください'); return }
  busy = true
  render()
  void api<{ amazonAffiliateEnabled: boolean }>('/api/config')
    .then(config => { $('amazon-disclosure').hidden = !config.amazonAffiliateEnabled })
    .catch(() => {})
  $('rooms').querySelectorAll('button').forEach(button => { button.disabled = true })
  try {
    await ensureSession()
    const result = await api<{ message: string; battle?: { log: string[] } }>(`/api/rooms/${encodeURIComponent(id)}/challenge`, { barcode: slots.left.barcode })
    status(result.message)
    log(result.battle?.log || [])
  } catch (error) { status(errorMessage(error)) }
  finally { busy = false; render(); await refreshRooms() }
}
function mode(value: boolean) {
  clearDuel()
  online = value
  $('local-tab').setAttribute('aria-pressed', String(!value))
  $('rooms-tab').setAttribute('aria-pressed', String(value))
  $('local-controls').hidden = value
  $('room-controls').hidden = !value
  if (value) setSlot('left')
  render()
  if (value) void refreshRooms()
}
$('local-tab').addEventListener('click', () => mode(false))
$('rooms-tab').addEventListener('click', () => mode(true))
$('refresh').addEventListener('click', () => void refreshRooms())
render()
