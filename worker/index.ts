import { battle as simulateBattle, combineFighters, decodeBarcode, validateBarcode } from '../src/game.ts'
import { amazonAffiliateEnabled, amazonApiEnabled, amazonSearchLinks, AMAZON_ASSOCIATE_TAG, searchAmazonProduct, type AmazonEnv } from './amazon.ts'
import { isIsbn, LINKED_IMAGE_HOSTS, resolveOpenBD, resolveOpenFacts, resolveYahoo } from './products.ts'

interface Env extends AmazonEnv {
  /** Yahoo! JAPAN Client ID for 商品検索 v3; enables the Yahoo!ショッピング lookup and its credit. */
  YAHOO_APP_ID?: string
  DB: D1Database
  IMAGES: R2Bucket
  ASSETS: Fetcher
}

interface Room {
  id: string
  name: string
  description: string
  barcode_prefix: string | null
  sort_order: number
  second_card: 'none' | 'both'
  allow_heal: number
  require_known_product: number
  champion_second_barcode: string | null
  revision: number
  champion_barcode: string | null
  champion_fighter: string | null
  champion_owner_hash: string | null
  champion_wins: number
  last_battle_id: string | null
  updated_at: number
  champion_product_name?: string | null
  champion_has_thumbnail?: number | null
  champion_product_source?: string | null
  champion_product_asin?: string | null
  champion_thumbnail_url?: string | null
  champion_second_name?: string | null
  champion_second_has_thumbnail?: number | null
  champion_second_source?: string | null
  champion_second_asin?: string | null
  champion_second_thumbnail_url?: string | null
}

interface ProductRow {
  barcode: string
  name: string | null
  has_thumbnail: number
  checked_at: number
  source: string
  asin: string | null
  thumbnail_url: string | null
}

class HttpError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message)
  }
}

const COOKIE = 'bb_session'
const SESSION_SECONDS = 365 * 24 * 60 * 60
const encoder = new TextEncoder()
const ROOM_SELECT = 'SELECT rooms.*, products.name AS champion_product_name, ' +
  'products.has_thumbnail AS champion_has_thumbnail, products.source AS champion_product_source, ' +
  'products.asin AS champion_product_asin, products.thumbnail_url AS champion_thumbnail_url, ' +
  'second.name AS champion_second_name, second.has_thumbnail AS champion_second_has_thumbnail, ' +
  'second.source AS champion_second_source, second.asin AS champion_second_asin, ' +
  'second.thumbnail_url AS champion_second_thumbnail_url FROM rooms ' +
  'LEFT JOIN products ON products.barcode = rooms.champion_barcode ' +
  'LEFT JOIN products AS second ON second.barcode = rooms.champion_second_barcode'

function headers(api = true): Headers {
  const result = new Headers({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(self), microphone=(), geolocation=()',
    'Content-Security-Policy': `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://m.media-amazon.com https://images-fe.ssl-images-amazon.com https://images-jp.ssl-images-amazon.com https://images-na.ssl-images-amazon.com ${LINKED_IMAGE_HOSTS.yahoo.map(host => `https://${host}`).join(' ')} ${LINKED_IMAGE_HOSTS.openbd.map(host => `https://${host}`).join(' ')}; connect-src 'self'; media-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`,
  })
  if (api) {
    result.set('Cache-Control', 'no-store')
    result.set('Content-Type', 'application/json; charset=utf-8')
  }
  return result
}

function json(value: unknown, status = 200, extra?: HeadersInit): Response {
  const h = headers()
  if (extra) new Headers(extra).forEach((v, k) => h.set(k, v))
  return new Response(JSON.stringify(value), { status, headers: h })
}

function now(): number {
  return Math.floor(Date.now() / 1000)
}

async function hash(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', encoder.encode(value))
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('')
}

function cookieValue(request: Request): string | null {
  const entry = request.headers.get('Cookie')?.split(';').map(s => s.trim())
    .find(s => s.startsWith(`${COOKIE}=`))
  const value = entry?.slice(COOKIE.length + 1)
  return value && /^[a-f0-9-]{73}$/.test(value) ? value : null
}

async function session(request: Request, env: Env): Promise<string | null> {
  const value = cookieValue(request)
  if (!value) return null
  const id = await hash(value)
  const row = await env.DB.prepare('SELECT id_hash FROM sessions WHERE id_hash = ? AND expires_at > ?')
    .bind(id, now()).first()
  return row ? id : null
}

async function requireSession(request: Request, env: Env): Promise<string> {
  const id = await session(request, env)
  if (!id) throw new HttpError(401, 'SESSION_REQUIRED', 'Initialize a session first.')
  return id
}

async function initializeSession(request: Request, env: Env): Promise<Response> {
  const current = await session(request, env)
  if (current) return json({ sessionId: current })
  const created = await createSession(request, env)
  return json({ sessionId: created.id }, 200, { 'Set-Cookie': created.cookie })
}

async function createSession(request: Request, env: Env): Promise<{ id: string; cookie: string }> {
  const value = `${crypto.randomUUID()}-${crypto.randomUUID()}`
  const id = await hash(value)
  await env.DB.prepare('INSERT INTO sessions (id_hash, created_at, expires_at) VALUES (?, ?, ?)')
    .bind(id, now(), now() + SESSION_SECONDS).run()
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : ''
  return { id, cookie: `${COOKIE}=${value}; Path=/; Max-Age=${SESSION_SECONDS}; HttpOnly; SameSite=Strict${secure}` }
}

async function rateLimit(env: Env, owner: string, scope: string, limit: number): Promise<void> {
  const bucket = Math.floor(now() / 60)
  const row = await env.DB.prepare(
    'INSERT INTO rate_limits (session_hash, scope, bucket, hits) VALUES (?, ?, ?, 1) ' +
    'ON CONFLICT(session_hash, scope, bucket) DO UPDATE SET hits = hits + 1 RETURNING hits',
  ).bind(owner, scope, bucket).first<{ hits: number }>()
  if (!row || row.hits > limit) throw new HttpError(429, 'RATE_LIMITED', 'Too many requests. Try again in a minute.')
}

async function rateLimitProductIp(request: Request, env: Env, owner: string): Promise<void> {
  const ip = request.headers.get('CF-Connecting-IP')
  if (!ip) return
  const scope = `product-ip:${await hash(ip)}`
  await rateLimit(env, owner, scope, 60)
  const row = await env.DB.prepare('SELECT SUM(hits) AS hits FROM rate_limits WHERE scope = ? AND bucket = ?')
    .bind(scope, Math.floor(now() / 60)).first<{ hits: number }>()
  if (!row || row.hits > 60) throw new HttpError(429, 'RATE_LIMITED', 'Too many requests. Try again in a minute.')
}

async function readBounded(body: ReadableStream<Uint8Array> | null, max: number): Promise<Uint8Array> {
  if (!body) return new Uint8Array()
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > max) {
        await reader.cancel()
        throw new HttpError(413, 'BODY_TOO_LARGE', 'Request body is too large.')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const result = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.length
  }
  return result
}

async function body(request: Request): Promise<Record<string, unknown>> {
  if (request.headers.get('Content-Type')?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
    throw new HttpError(415, 'JSON_REQUIRED', 'Use application/json.')
  }
  if (Number(request.headers.get('Content-Length') ?? 0) > 2048) {
    throw new HttpError(413, 'BODY_TOO_LARGE', 'Request body is too large.')
  }
  const data = await readBounded(request.body, 2048)
  let parsed: unknown
  try {
    parsed = JSON.parse(new TextDecoder().decode(data))
  } catch {
    throw new HttpError(400, 'INVALID_JSON', 'Invalid JSON body.')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new HttpError(400, 'INVALID_JSON', 'Expected a JSON object.')
  }
  return parsed as Record<string, unknown>
}

function barcode(value: unknown): string {
  if (typeof value !== 'string' || !/^(?:\d{8}|\d{13})$/.test(value) || !validateBarcode(value)) {
    throw new HttpError(400, 'INVALID_BARCODE', 'Use a valid EAN-8 or EAN-13 barcode with its check digit.')
  }
  return value
}

function publicRoom(room: Room, owner: string | null, env: Env) {
  return {
    id: room.id,
    name: room.name,
    description: room.description,
    regulation: room.description,
    barcodePrefix: room.barcode_prefix,
    secondCard: room.second_card,
    allowHeal: room.allow_heal === 1,
    requireKnownProduct: room.require_known_product === 1,
    revision: room.revision,
    champion: room.champion_barcode ? {
      barcode: room.champion_barcode,
      secondBarcode: room.champion_second_barcode,
      fighter: JSON.parse(room.champion_fighter!),
      wins: room.champion_wins,
      isOwner: owner === room.champion_owner_hash,
      product: productValue({
        barcode: room.champion_barcode,
        name: room.champion_product_name ?? null,
        has_thumbnail: room.champion_has_thumbnail ?? 0,
        checked_at: 0,
        source: room.champion_product_source ?? 'openfoodfacts',
        asin: room.champion_product_asin ?? null,
        thumbnail_url: room.champion_thumbnail_url ?? null,
      }),
      secondProduct: room.champion_second_barcode ? productValue({
        barcode: room.champion_second_barcode,
        name: room.champion_second_name ?? null,
        has_thumbnail: room.champion_second_has_thumbnail ?? 0,
        checked_at: 0,
        source: room.champion_second_source ?? 'none',
        asin: room.champion_second_asin ?? null,
        thumbnail_url: room.champion_second_thumbnail_url ?? null,
      }) : null,
    } : null,
    updatedAt: room.updated_at,
  }
}

async function getRoom(env: Env, id: string): Promise<Room> {
  const room = await env.DB.prepare(`${ROOM_SELECT} WHERE rooms.id = ? AND rooms.enabled = 1`).bind(id).first<Room>()
  if (!room) throw new HttpError(404, 'ROOM_NOT_FOUND', 'Room not found.')
  return room
}

function productValue(row: ProductRow | null, code = row?.barcode) {
  if (!code) return null
  const amazon = row?.source === 'amazon' && row.asin
  const thumbnail = row?.thumbnail_url ?? (row?.has_thumbnail ? `/api/images/${code}` : null)
  const searchLinks = amazonSearchLinks(code)
  return {
    name: row?.name ?? null,
    thumbnail,
    amazonAsin: amazon ? row!.asin : null,
    amazonLinkType: amazon ? 'product' as const : 'search' as const,
    amazonAffiliateUrl: amazon
      ? `https://www.amazon.co.jp/dp/${row!.asin}?tag=${encodeURIComponent(AMAZON_ASSOCIATE_TAG)}`
      : searchLinks.affiliateUrl,
    amazonStandardUrl: amazon ? `https://www.amazon.co.jp/dp/${row!.asin}` : searchLinks.standardUrl,
  }
}

async function fetchBytes(url: string, max: number): Promise<{ bytes: Uint8Array; type: string }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 3500)
  try {
    const response = await fetch(url, {
      // Workers reject redirect: 'error'; take 3xx as unavailable instead.
      redirect: 'manual',
      signal: controller.signal,
      headers: { 'User-Agent': 'BarcodeBattlerWeb/1.0 (product metadata cache)' },
    })
    if (!response.ok || Number(response.headers.get('Content-Length') ?? 0) > max) {
      await response.body?.cancel()
      throw new Error('Upstream response unavailable.')
    }
    return { bytes: await readBounded(response.body, max), type: response.headers.get('Content-Type') ?? '' }
  } finally {
    clearTimeout(timer)
  }
}

function imageType(bytes: Uint8Array): string | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((n, i) => bytes[i] === n)) return 'image/png'
  if (bytes.length >= 12 && new TextDecoder().decode(bytes.slice(0, 4)) === 'RIFF' &&
    new TextDecoder().decode(bytes.slice(8, 12)) === 'WEBP') return 'image/webp'
  return null
}

/** Upstream fetch of a small JSON document (redirects are not followed). */
async function fetchJson(url: string): Promise<unknown> {
  const { bytes, type } = await fetchBytes(url, 256 * 1024)
  if (!type.toLowerCase().includes('json')) throw new Error('Unexpected metadata type.')
  return JSON.parse(new TextDecoder().decode(bytes))
}

const FOUND_TTL = 7 * 86400
const AMAZON_TTL = 86400
const MISSING_TTL = 6 * 3600

/**
 * Resolve a product name and thumbnail as hard as reasonable: Amazon (Creators
 * API, when configured), Yahoo!ショッピング (when YAHOO_APP_ID is set), openBD for
 * ISBNs, then Open Food / Beauty / Products / Pet Food Facts. Results, including
 * misses, are cached in D1; product data never decides a battle.
 */
async function lookupProduct(env: Env, code: string) {
  const cached = await env.DB.prepare('SELECT * FROM products WHERE barcode = ?').bind(code).first<ProductRow>()
  if (cached) {
    const ttl = cached.source === 'amazon' ? AMAZON_TTL : cached.name || cached.has_thumbnail || cached.thumbnail_url ? FOUND_TTL : MISSING_TTL
    const amazonGone = cached.source === 'amazon' && !amazonApiEnabled(env)
    if (now() - cached.checked_at < ttl && !amazonGone) return productValue(cached)
  }
  type Found = { source: string; name: string | null; asin?: string | null; thumbnailUrl?: string | null; cacheImageUrl?: string | null }
  const resolvers: (() => Promise<Found | null>)[] = []
  if (amazonApiEnabled(env)) {
    resolvers.push(async () => {
      const amazon = await searchAmazonProduct(env, code)
      return amazon ? { source: 'amazon', name: amazon.name, asin: amazon.asin, thumbnailUrl: amazon.thumbnail } : null
    })
  }
  if (env.YAHOO_APP_ID) resolvers.push(() => resolveYahoo(env.YAHOO_APP_ID!, code, fetchJson))
  if (isIsbn(code)) resolvers.push(() => resolveOpenBD(code, fetchJson))
  resolvers.push(() => resolveOpenFacts(code, fetchJson))

  // The first source with a name wins; later sources may still supply a missing image.
  let found = null as Found | null
  for (const resolve of resolvers) {
    let next: Found | null = null
    try { next = await resolve() } catch { next = null }
    if (!next) continue
    if (!found) found = next
    else if (!found.thumbnailUrl && !found.cacheImageUrl) found = { ...found, thumbnailUrl: next.thumbnailUrl, cacheImageUrl: next.cacheImageUrl }
    if (found.name && (found.thumbnailUrl || found.cacheImageUrl)) break
    if (!found.name && next.name) {
      const image = next.thumbnailUrl || next.cacheImageUrl ? next : found
      found = { ...next, thumbnailUrl: image.thumbnailUrl, cacheImageUrl: image.cacheImageUrl }
    }
  }
  let hasThumbnail = 0
  if (found?.cacheImageUrl) {
    try {
      const image = await fetchBytes(found.cacheImageUrl, 512 * 1024)
      const contentType = imageType(image.bytes)
      if (contentType) {
        await env.IMAGES.put(`products/${code}`, image.bytes, { httpMetadata: { contentType } })
        hasThumbnail = 1
      }
    } catch {
      // Product names remain useful when the optional image is unavailable.
    }
  }
  const row: ProductRow = {
    barcode: code, name: found?.name ?? null, has_thumbnail: hasThumbnail, checked_at: now(),
    source: found?.source ?? 'none', asin: found?.asin ?? null, thumbnail_url: found?.thumbnailUrl ?? null,
  }
  await env.DB.prepare(
    'INSERT INTO products (barcode, name, has_thumbnail, checked_at, source, asin, thumbnail_url) VALUES (?, ?, ?, ?, ?, ?, ?) ' +
    'ON CONFLICT(barcode) DO UPDATE SET name = excluded.name, has_thumbnail = excluded.has_thumbnail, ' +
    'checked_at = excluded.checked_at, source = excluded.source, asin = excluded.asin, thumbnail_url = excluded.thumbnail_url',
  ).bind(row.barcode, row.name, row.has_thumbnail, row.checked_at, row.source, row.asin, row.thumbnail_url).run()
  return productValue(row)
}

async function challenge(request: Request, env: Env, roomId: string): Promise<Response> {
  const owner = await requireSession(request, env)
  await rateLimit(env, owner, 'challenge', 12)
  const input = await body(request)
  const code = barcode(input.barcode)
  const secondCode = input.secondBarcode === undefined || input.secondBarcode === null || input.secondBarcode === ''
    ? null : barcode(input.secondBarcode)
  const room = await getRoom(env, roomId)
  for (const card of [code, secondCode]) {
    if (card && room.barcode_prefix && !card.startsWith(room.barcode_prefix)) {
      throw new HttpError(400, 'ROOM_BARCODE_RESTRICTED', `This room requires barcodes beginning with ${room.barcode_prefix}.`)
    }
  }
  if (secondCode && room.second_card === 'none') {
    throw new HttpError(400, 'SECOND_CARD_NOT_ALLOWED', 'This room allows one character card only.')
  }
  if (room.champion_owner_hash === owner) {
    throw new HttpError(409, 'OWN_CHAMPION', 'You cannot challenge your own champion.')
  }
  const rng = () => crypto.getRandomValues(new Uint32Array(1))[0]! / 4294967296
  let fighter: ReturnType<typeof decodeBarcode>
  try {
    fighter = decodeBarcode(code, { rng })
  } catch {
    throw new HttpError(400, 'INVALID_FIGHTER', 'This barcode cannot enter a standalone battle.')
  }
  if (fighter.kind !== 'fighter' || fighter.race > 4) {
    throw new HttpError(400, 'ITEM_NOT_FIGHTER', 'This barcode is an item. Choose a fighter barcode for room battles.')
  }
  if (secondCode) {
    try {
      fighter = combineFighters(fighter, decodeBarcode(secondCode, { rng }), { mode: 'C0' })
    } catch (error) {
      throw new HttpError(400, 'INVALID_SECOND_CARD', error instanceof Error ? error.message : 'These cards cannot be combined.')
    }
  }
  if (room.require_known_product) {
    for (const card of [code, secondCode]) {
      if (!card) continue
      let name: string | null = null
      try { name = (await lookupProduct(env, card))?.name ?? null } catch { /* Treated as unknown below. */ }
      if (!name) throw new HttpError(400, 'UNKNOWN_PRODUCT', 'This room accepts barcodes of known products only.')
    }
  }
  const battle = room.champion_fighter
    ? simulateBattle(JSON.parse(room.champion_fighter), fighter, rng, { noHeal: room.allow_heal !== 1 })
    : { winner: 'right' as const, rounds: 0, log: ['The challenger claims the empty room.'],
      leftHp: 0, rightHp: fighter.hp, reason: 'empty_room' }
  const challengerWon = battle.winner === 'right'
  const winnerBarcode = challengerWon ? code : room.champion_barcode!
  const winnerSecond = challengerWon ? secondCode : room.champion_second_barcode
  const winnerFighter = challengerWon ? JSON.stringify(fighter) : room.champion_fighter!
  const winnerOwner = challengerWon ? owner : room.champion_owner_hash!
  const wins = !room.champion_barcode ? 0 : challengerWon ? 1 : room.champion_wins + 1
  const id = crypto.randomUUID()
  const timestamp = now()
  const results = await env.DB.batch([
    env.DB.prepare(
      'UPDATE rooms SET revision = revision + 1, champion_barcode = ?, champion_second_barcode = ?, champion_fighter = ?, ' +
      'champion_owner_hash = ?, champion_wins = ?, last_battle_id = ?, updated_at = ? WHERE id = ? AND revision = ? AND enabled = 1',
    ).bind(winnerBarcode, winnerSecond, winnerFighter, winnerOwner, wins, id, timestamp, roomId, room.revision),
    env.DB.prepare(
      'INSERT INTO battles (id, room_id, room_revision, challenger_barcode, challenger_second_barcode, defender_barcode, defender_second_barcode, ' +
      'challenger_owner_hash, winner_barcode, result, created_at) ' +
      'SELECT ?, id, revision, ?, ?, ?, ?, ?, ?, ?, ? FROM rooms WHERE id = ? AND last_battle_id = ?',
    ).bind(id, code, secondCode, room.champion_barcode, room.champion_second_barcode, owner, winnerBarcode, JSON.stringify(battle), timestamp, roomId, id),
  ])
  if (results[0]!.meta.changes !== 1 || results[1]!.meta.changes !== 1) {
    throw new HttpError(409, 'CHAMPION_CHANGED', 'The champion changed. Refresh the room and try again.')
  }
  let product = null
  try { product = await lookupProduct(env, code) } catch { /* Optional metadata must not invalidate committed battles. */ }
  // Cache the second card's product too, so the room list can show it.
  if (secondCode) try { await lookupProduct(env, secondCode) } catch { /* Optional metadata. */ }
  const updated: Room = {
    ...room, revision: room.revision + 1, champion_barcode: winnerBarcode, champion_second_barcode: winnerSecond, champion_fighter: winnerFighter,
    champion_owner_hash: winnerOwner, champion_wins: wins, last_battle_id: id, updated_at: timestamp,
    champion_product_name: challengerWon ? product?.name ?? null : room.champion_product_name,
    champion_has_thumbnail: challengerWon ? (product?.thumbnail ? 1 : 0) : room.champion_has_thumbnail,
    champion_product_source: challengerWon ? (product?.amazonAsin ? 'amazon' : 'other') : room.champion_product_source,
    champion_product_asin: challengerWon ? product?.amazonAsin ?? null : room.champion_product_asin,
    champion_thumbnail_url: challengerWon ? product?.thumbnail ?? null : room.champion_thumbnail_url,
  }
  const publicResult = publicRoom(updated, owner, env)
  const message = !room.champion_barcode ? 'You are the first champion of this room.'
    : challengerWon ? 'Victory! Your fighter is the new champion.' : 'The champion defended the room. Try another fighter.'
  return json({ message, battle: { ...battle, id, roomId, challengerBarcode: code, challengerSecondBarcode: secondCode,
    defenderBarcode: room.champion_barcode, defenderSecondBarcode: room.champion_second_barcode, winnerBarcode, createdAt: timestamp },
    room: publicResult, champion: publicResult.champion, product })
}

async function api(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const path = url.pathname
  if (request.method === 'POST' && request.headers.get('Origin') !== url.origin) {
    throw new HttpError(403, 'INVALID_ORIGIN', 'A same-origin request is required.')
  }
  if ((request.method === 'GET' || request.method === 'POST') && path === '/api/session') {
    if (request.method === 'POST') await readBounded(request.body, 2048)
    return initializeSession(request, env)
  }
  if (request.method === 'GET' && path === '/api/config') {
    return json({ amazonAffiliateEnabled: amazonAffiliateEnabled(), yahooCredit: !!env.YAHOO_APP_ID })
  }
  if (request.method === 'GET' && path === '/api/rooms') {
    const owner = await session(request, env)
    const rows = await env.DB.prepare(`${ROOM_SELECT} WHERE rooms.enabled = 1 ORDER BY rooms.sort_order, rooms.id`).all<Room>()
    return json({ rooms: rows.results.map(room => publicRoom(room, owner, env)) })
  }
  const roomMatch = /^\/api\/rooms\/([a-z0-9_-]+)$/.exec(path)
  if (request.method === 'GET' && roomMatch) {
    const owner = await session(request, env)
    const room = publicRoom(await getRoom(env, roomMatch[1]!), owner, env)
    const rows = await env.DB.prepare(
      'SELECT id, challenger_barcode, defender_barcode, winner_barcode, result, created_at FROM battles WHERE room_id = ? ORDER BY room_revision DESC LIMIT 20',
    ).bind(roomMatch[1]).all<{ id: string; challenger_barcode: string; defender_barcode: string | null; winner_barcode: string; result: string; created_at: number }>()
    return json({ room, champion: room.champion, battles: rows.results.map(row => ({
      ...JSON.parse(row.result), id: row.id, challengerBarcode: row.challenger_barcode,
      defenderBarcode: row.defender_barcode, winnerBarcode: row.winner_barcode, createdAt: row.created_at,
    })) })
  }
  const challengeMatch = /^\/api\/rooms\/([a-z0-9_-]+)\/challenge$/.exec(path)
  if (request.method === 'POST' && challengeMatch) return challenge(request, env, challengeMatch[1]!)
  const productMatch = /^\/api\/products\/(\d+)$/.exec(path)
  if (request.method === 'GET' && productMatch) {
    const code = barcode(productMatch[1])
    let owner = await session(request, env)
    let extra: HeadersInit | undefined
    if (!owner) {
      const created = await createSession(request, env)
      owner = created.id
      extra = { 'Set-Cookie': created.cookie }
    }
    await rateLimit(env, owner, 'product', 30)
    await rateLimitProductIp(request, env, owner)
    return json({
      product: await lookupProduct(env, code),
      amazonAffiliateEnabled: amazonAffiliateEnabled(),
      yahooCredit: !!env.YAHOO_APP_ID,
    }, 200, extra)
  }
  const imageMatch = /^\/api\/images\/(\d+)$/.exec(path)
  if (request.method === 'GET' && imageMatch) {
    const code = barcode(imageMatch[1])
    const image = await env.IMAGES.get(`products/${code}`)
    if (!image) throw new HttpError(404, 'IMAGE_NOT_FOUND', 'Image not found.')
    const type = image.httpMetadata?.contentType
    if (!type || !['image/jpeg', 'image/png', 'image/webp'].includes(type)) {
      throw new HttpError(404, 'IMAGE_NOT_FOUND', 'Image not found.')
    }
    const h = headers()
    h.set('Content-Type', type)
    h.set('Cache-Control', 'public, max-age=86400')
    h.set('ETag', image.httpEtag)
    return new Response(image.body, { headers: h })
  }
  if (!['GET', 'POST'].includes(request.method)) throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed.')
  throw new HttpError(404, 'NOT_FOUND', 'API route not found.')
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const url = new URL(request.url)
      if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return await api(request, env)
      const asset = await env.ASSETS.fetch(request)
      const secured = new Response(asset.body, asset)
      headers(false).forEach((value, key) => secured.headers.set(key, value))
      return secured
    } catch (error) {
      if (error instanceof HttpError) {
        return json({ error: { code: error.code, message: error.message } }, error.status,
          error.status === 429 ? { 'Retry-After': String(60 - now() % 60) } : undefined)
      }
      console.error('Worker request failed', error instanceof Error ? error.name : 'UnknownError')
      return json({ error: { code: 'INTERNAL_ERROR', message: 'The request could not be completed.' } }, 500)
    }
  },
} satisfies ExportedHandler<Env>
