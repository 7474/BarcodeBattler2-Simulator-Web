import './style.css'
import type { IScannerControls } from '@zxing/browser'
import { createBattle, combineFighters, decodeBarcode, MAGIC_COSTS, type BattleAction, type BattleSession, type Fighter } from './game.ts'
import { campaignEnemy, createCampaign, finishCampaignBattle, selectCampaignWorld, setCampaignEnemy, switchCampaignHero, type Campaign } from './campaign.ts'

type Product = { name: string; thumbnail: string | null }
type Room = { id: string; name: string; barcodePrefix: string | null; champion: { barcode: string; wins: number; isOwner?: boolean; product?: Product | null } | null }

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <header><span class="brand">BARCODE BATTLER <b>II</b></span><span class="badge">WEB SIMULATOR</span></header>
  <main>
    <div class="intro"><h1>そのバーコードが、戦士になる。</h1><p>カメラで読み取る、育てず戦う。非公式バーコードバトル・シミュレータ</p></div>
    <nav aria-label="ゲームモード"><button id="local-tab" aria-pressed="true">ローカル対戦</button><button id="rooms-tab" aria-pressed="false">勝ち抜き対戦部屋</button></nav>
    <section class="console" aria-label="ゲーム機">
      <div class="console-label">BARCODE BATTLER II <span>POWER ●</span></div>
      <div class="lcd" aria-live="polite"><div id="status">バーコードを読み取ってください</div><div id="fighters" class="fighters"></div></div>
      <div class="controls">
        <form id="scan-form"><label for="barcode">バーコード（JAN / EAN 8桁・13桁）</label><div class="input-row"><input id="barcode" name="barcode" inputmode="numeric" pattern="[0-9]{8}|[0-9]{13}" maxlength="13" autocomplete="off" required placeholder="例: 4901234567894"><button type="submit">読み込む</button></div></form>
        <div class="input-row"><label for="slot">読み込み先</label><select id="slot"><option value="left">1P 戦士 / 主人公の戦士</option><option value="right">2P 戦士 / 主人公の魔法使い</option><option value="left-card">1P 合体・アイテム</option><option value="right-card">2P 合体・アイテム</option><option value="enemy">C2の敵</option></select><button id="camera" type="button">📷 カメラで読む</button></div>
        <div id="camera-panel" hidden><video id="video" muted playsinline aria-label="バーコードカメラ"></video><button id="stop-camera">カメラを停止</button></div>
        <div id="local-controls">
          <div class="input-row"><label for="game-mode">ゲームモード</label><select id="game-mode"><option value="C0">C0 自由対戦</option><option value="C1">C1 生成敵との冒険</option><option value="C2">C2 読み取った敵に挑戦</option></select><button id="start-campaign" hidden>モード開始</button></div>
          <div id="campaign-setup" hidden>
            <p>1Pに戦士の主人公、2Pに魔法使いの主人公を読み込んでから開始してください。</p>
            <label for="enemy-barcode">C2の敵バーコード（読込先「C2の敵」でカメラ読取可能）</label><input id="enemy-barcode" inputmode="numeric" maxlength="13" placeholder="C2: 敵の8桁・13桁コード">
            <label for="password">パスワード（任意）</label><input id="password" inputmode="numeric" maxlength="5" placeholder="3桁または5桁">
          </div>
          <p id="campaign-status" hidden></p>
          <div id="campaign-controls" class="input-row" hidden><button id="switch-hero">主人公を交代</button><button id="set-enemy">C2の敵を設定</button><span id="world-controls"><select id="world" aria-label="C1ワールド"><option value="1">L-1</option><option value="2">L-2</option><option value="3">L-3</option><option value="4">L-4</option><option value="5">L-5</option><option value="H">L-H（鍵3個）</option></select> <button id="set-world">ワールドへ移動</button></span></div>
          <div class="input-row"><button id="fight" class="primary" disabled>⚔ BATTLE</button><button id="reset">リセット</button></div>
          <div id="battle-actions" hidden>
            <p id="turn"></p>
            <div class="input-row"><button id="attack">攻撃</button><button id="power">POWER</button><label for="timing">タイミング</label><select id="timing"><option value="1">通常</option><option value="2">強打</option></select></div>
            <div class="input-row"><select id="herbs" aria-label="薬草の数"><option value="1">薬草1個</option><option value="2">薬草2個</option><option value="3">薬草3個</option></select><button id="heal">薬草を使う</button></div>
            <div class="input-row"><select id="spell" aria-label="魔法">${MAGIC_COSTS.map((cost, index) => `<option value="${index}">F${index}（MP ${cost}）</option>`).join('')}</select><button id="magic">魔法</button></div>
          </div>
        </div>
        <div id="room-controls" hidden><p>1Pに読み込んだ戦士で挑戦します。勝者が部屋に残り、次の挑戦を待ちます。</p><button id="refresh">部屋を更新</button><div id="rooms"></div></div>
      </div>
      <details><summary>バトルログ</summary><ol id="log"></ol></details>
    </section>
    <section class="help"><h2>遊び方</h2><p>1Pと2Pのバーコードを読み込んで対戦、または1Pの戦士で対戦部屋に挑戦してください。ローカルでは「合体・アイテム」を選び、2枚目を読み込めます。対戦部屋では元の1枚のみを使います。カメラを使えない場合は数字を入力できます。</p><p>「国内49コード」部屋は49で始まるコード専用。「無差別」部屋はすべての有効なJAN/EANコードが対象です。商品名・画像は見つかった場合のみ表示されます。</p><p>カメラにはHTTPSまたはlocalhostとアクセス許可が必要です。映像をサーバーへ送信することはありません。</p><p>逃走・戦闘後アイテムなど一部の実機操作は未対応です。</p></section>
  </main><footer>非公式ファンプロジェクト · 原作ゲーム・商標の権利は各権利者に帰属します<br>商品データ: <a href="https://world.openfoodfacts.org/" target="_blank" rel="noreferrer">Open Food Facts</a>（ODbL / 画像 CC BY-SA）</footer>`

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const slots: { left: Fighter | null; right: Fighter | null } = { left: null, right: null }
const products = new Map<string, Product>()
const combined = new Set<'left' | 'right'>()
const secondCards = new Map<'left' | 'right', string>()
const heroCards = new Map<'left' | 'right', string>()
let campaign: Campaign | null = null
let duel: BattleSession | null = null
let duelOriginal: { left: Fighter; right: Fighter } | null = null
let campaignDuelResolved = false
let guardianStar: 0 | 1 | 2 | undefined
let online = false
let busy = false
let scanner: IScannerControls | undefined
let cameraGeneration = 0
let session: Promise<unknown> | undefined

function status(message: string) { $('status').textContent = message }
function log(lines: string[]) {
  $('log').replaceChildren(...lines.map(line => {
    const li = document.createElement('li')
    li.textContent = line
    return li
  }))
}
async function api<T>(path: string, body?: object): Promise<T> {
  const response = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error?.message || '通信に失敗しました')
  return data as T
}
function ensureSession() {
  session ??= api('/api/session').catch(error => { session = undefined; throw error })
  return session
}
function errorMessage(error: unknown) { return error instanceof Error ? error.message : '処理に失敗しました' }
function clearDuel() {
  if (duelOriginal) { slots.left = duelOriginal.left; slots.right = duelOriginal.right }
  duel = null
  duelOriginal = null
  $('battle-actions').hidden = true
}
function render() {
  $('fighters').replaceChildren(...(['left', 'right'] as const).map((side, index) => {
    const card = document.createElement('article')
    const fighter = slots[side]
    const heading = document.createElement('h2')
    heading.textContent = `${index + 1}P ${fighter ? fighter.name : '待機中'}`
    card.append(heading)
    if (fighter) {
      const product = products.get(fighter.barcode)
      if (product?.thumbnail?.startsWith('/api/images/')) {
        const image = document.createElement('img')
        image.src = product.thumbnail
        image.alt = product.name
        image.className = 'product-image'
        card.append(image)
      }
      const label = document.createElement('p')
      label.textContent = product?.name || fighter.barcode
      const stats = document.createElement('p')
      stats.className = 'stats'
      stats.textContent = `HP ${fighter.hp} / 攻 ${fighter.attack} / 守 ${fighter.defense} / MP ${fighter.mp} / 薬草 ${fighter.pp}`
      card.append(label, stats)
    }
    return card
  }))
  $<HTMLButtonElement>('fight').disabled = !slots.left || !slots.right || busy ||
    ($<HTMLSelectElement>('game-mode').value !== 'C0' && (!campaign || campaign.complete || campaign.defeated))
  $('fight').textContent = duel && !duel.snapshot().result ? '自動で最後まで' : '⚔ BATTLE'
}
async function loadBarcode(barcode: string) {
  try {
    const fighter = decodeBarcode(barcode.trim())
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
      status('C2の敵を読み込みました')
      return
    }
    clearDuel()
    const side = target.startsWith('left') ? 'left' : 'right'
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
    render()
    if (side === 'left' && !online) $<HTMLSelectElement>('slot').value = 'right'
    try {
      await ensureSession()
      const result = await api<{ product: Product | null }>(`/api/products/${fighter.barcode}`)
      if (result.product) products.set(fighter.barcode, result.product)
      render()
    } catch { /* Product lookup must not prevent local play. */ }
  } catch (error) { status(errorMessage(error)) }
}
$('scan-form').addEventListener('submit', event => {
  event.preventDefault()
  void loadBarcode($<HTMLInputElement>('barcode').value)
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
  $('turn').textContent = `${snapshot.turn === 'left' ? '1P' : '2P'} のターン`
  const active = snapshot[snapshot.turn]
  $<HTMLButtonElement>('magic').disabled = active.job <= 6
  $<HTMLButtonElement>('heal').disabled = active.pp === 0 || snapshot.herbsBlocked[snapshot.turn]
  status(snapshot.result
    ? `${snapshot.result.winner === 'left' ? '1P' : '2P'} WIN! — ${snapshot.rounds}ターン`
    : `${snapshot.turn === 'left' ? '1P' : '2P'} の操作を選んでください`)
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
  status('バーコードを読み取ってください')
  $<HTMLSelectElement>('slot').value = 'left'
  render()
})
$('game-mode').addEventListener('change', () => {
  clearDuel()
  campaign = null
  guardianStar = undefined
  $('campaign-status').hidden = true
  $('campaign-controls').hidden = true
  $('start-campaign').hidden = $<HTMLSelectElement>('game-mode').value === 'C0'
  $('campaign-setup').hidden = $<HTMLSelectElement>('game-mode').value === 'C0'
  status($<HTMLSelectElement>('game-mode').value === 'C0'
    ? '1Pと2Pを読み込み、BATTLEを押してください'
    : '主人公の戦士・魔法使いを読み込み、モード開始を押してください')
  render()
})
$('start-campaign').addEventListener('click', () => {
  if (!slots.left) { status('先に1Pの主人公を読み込んでください'); return }
  try {
    const mode = $<HTMLSelectElement>('game-mode').value as 'C1' | 'C2'
    campaign = createCampaign(mode, heroCards.get('left') || slots.left.barcode, secondCards.get('left'), {
      magicianBarcode: heroCards.get('right'),
      enemyBarcode: $<HTMLInputElement>('enemy-barcode').value.trim() || undefined,
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
    campaign = setCampaignEnemy(campaign, $<HTMLInputElement>('enemy-barcode').value.trim())
    slots.left = campaign.hero
    slots.right = campaignEnemy(campaign)
    updateCampaignStatus()
    render()
  } catch (error) { status(errorMessage(error)) }
})
function stopCamera() {
  cameraGeneration++
  scanner?.stop()
  scanner = undefined
  const video = $<HTMLVideoElement>('video')
  if (video.srcObject instanceof MediaStream) video.srcObject.getTracks().forEach(track => track.stop())
  video.srcObject = null
  $('camera-panel').hidden = true
}
$('camera').addEventListener('click', async () => {
  stopCamera()
  const generation = cameraGeneration
  $('camera-panel').hidden = false
  try {
    const { BrowserMultiFormatReader } = await import('@zxing/browser')
    if (generation !== cameraGeneration) return
    const reader = new BrowserMultiFormatReader()
    const controls = await reader.decodeFromConstraints(
      { video: { facingMode: { ideal: 'environment' } }, audio: false },
      $<HTMLVideoElement>('video'),
      (result, _error, controls) => {
        if (!result || generation !== cameraGeneration) return
        const code = result.getText()
        if (!/^(?:\d{8}|\d{13})$/.test(code)) return
        controls.stop()
        stopCamera()
        $<HTMLInputElement>('barcode').value = code
        void loadBarcode(code)
      },
    )
    if (generation !== cameraGeneration) controls.stop()
    else scanner = controls
  } catch {
    if (generation === cameraGeneration) {
      stopCamera()
      status('カメラを開始できません。HTTPS・カメラの許可を確認するか、数字を入力してください。')
    }
  }
})
$('stop-camera').addEventListener('click', stopCamera)
window.addEventListener('pagehide', stopCamera)
document.addEventListener('visibilitychange', () => { if (document.hidden) stopCamera() })

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
      button.textContent = room.champion?.isOwner ? 'あなたが現在の王者です' : 'この部屋に挑戦'
      button.disabled = busy || !!room.champion?.isOwner
      button.addEventListener('click', () => void challenge(room.id))
      const product = room.champion?.product
      if (product?.thumbnail?.startsWith('/api/images/')) {
        const image = document.createElement('img')
        image.src = product.thumbnail
        image.alt = product.name || room.champion!.barcode
        image.className = 'product-image'
        card.append(image)
      }
      const regulation = document.createElement('p')
      regulation.textContent = room.barcodePrefix ? `レギュレーション: ${room.barcodePrefix}で始まるコード` : 'レギュレーション: 無差別'
      card.append(heading, regulation, description, button)
      return card
    }))
  } catch (error) { status(`対戦部屋: ${errorMessage(error)}（Cloudflare Workerを起動してください）`) }
}
async function challenge(id: string) {
  if (busy) return
  if (!slots.left) { status('先に1Pのバーコードを読み込んでください'); return }
  busy = true
  render()
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
  if (value) {
    $<HTMLSelectElement>('slot').value = 'left'
    void refreshRooms()
  }
}
$('local-tab').addEventListener('click', () => mode(false))
$('rooms-tab').addEventListener('click', () => mode(true))
$('refresh').addEventListener('click', () => void refreshRooms())
render()
