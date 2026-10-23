import { validateBarcode } from './game.ts'

export type ScanInterpretation =
  | { ok: true; code: string }
  | { ok: false; reason: 'ignore' | 'checksum' }

const RETAIL_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e'] as const

type DetectedCode = { rawValue: string }
type CodeDetector = {
  detect: (source: CanvasImageSource) => Promise<DetectedCode[]>
}
type NativeBarcodeDetector = {
  new (options?: { formats?: string[] }): CodeDetector
  getSupportedFormats: () => Promise<string[]>
}

export interface CameraSession {
  stop: () => void
  torchAvailable: boolean
  setTorch: (on: boolean) => Promise<void>
}

export interface CameraHandlers {
  signal?: AbortSignal
  onCode: (code: string) => void
  onStatus?: (message: string) => void
}

/** Normalize a camera or keyboard read into a checksum-valid JAN/EAN code. */
export function interpretScan(raw: string): ScanInterpretation {
  const digits = raw
    .replace(/[０-９]/g, char => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace(/\D/g, '')
  const candidates = digits.length === 12 ? [`0${digits}`]
    : digits.length === 14 && digits.startsWith('0') ? [digits.slice(1)]
    : digits.length === 8 || digits.length === 13 ? [digits]
    : []
  if (candidates.length === 0) return { ok: false, reason: 'ignore' }
  return candidates.some(validateBarcode)
    ? { ok: true, code: candidates.find(validateBarcode)! }
    : { ok: false, reason: 'checksum' }
}

export function cameraErrorMessage(error: unknown): string {
  const name = error instanceof DOMException ? error.name : ''
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    return 'カメラの使用が拒否されました。ブラウザのサイト設定でカメラを許可するか、数字を入力してください。'
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return '使えるカメラが見つかりません。数字を入力してください。'
  }
  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return 'カメラを起動できません。ほかのアプリがカメラを使用中の可能性があります。'
  }
  if (name === 'SecurityError') {
    return 'カメラはHTTPSかlocalhostでのみ使えます。数字を入力してください。'
  }
  if (name === 'AbortError') return 'カメラの起動を中断しました。'
  if (error instanceof Error && /[ぁ-んァ-ン一-龠]/.test(error.message)) return error.message
  if (typeof window !== 'undefined' && !window.isSecureContext) {
    return 'カメラはHTTPSかlocalhostでのみ使えます。数字を入力してください。'
  }
  return 'カメラを開始できません。HTTPS・カメラの許可を確認するか、数字を入力してください。'
}

/**
 * Start the permission prompt in the same turn as the user's click.
 * iOS Safari drops getUserMedia calls that begin after an await.
 */
export function requestBarcodeCamera(): Promise<MediaStream> {
  if (typeof window === 'undefined' || !window.isSecureContext) {
    return Promise.reject(new Error('カメラはHTTPSかlocalhostでのみ使えます。数字を入力してください。'))
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    return Promise.reject(new Error('このブラウザはカメラ読み取りに対応していません。数字を入力してください。'))
  }
  return navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      facingMode: { ideal: 'environment' },
      width: { ideal: 1920 },
      height: { ideal: 1080 },
    },
  }).catch(error => {
    if (error instanceof DOMException && error.name === 'OverconstrainedError') {
      return navigator.mediaDevices.getUserMedia({ audio: false, video: true })
    }
    throw error
  })
}

function nativeBarcodeDetector(): NativeBarcodeDetector | undefined {
  const candidate = (globalThis as { BarcodeDetector?: NativeBarcodeDetector }).BarcodeDetector
  return typeof candidate === 'function' ? candidate : undefined
}

async function createWasmDetector(): Promise<CodeDetector> {
  const [{ BarcodeDetector, prepareZXingModule }, wasm] = await Promise.all([
    import('barcode-detector/ponyfill'),
    import('zxing-wasm/reader/zxing_reader.wasm?url'),
  ])
  // The wasm binary has to match the zxing-wasm version bundled with barcode-detector.
  // Instantiate eagerly: a lazy failure (e.g. a CSP without 'wasm-unsafe-eval')
  // would otherwise reject every frame silently and the camera would never read.
  const ready = prepareZXingModule({
    overrides: {
      locateFile: (path: string, prefix: string) => path.endsWith('.wasm') ? wasm.default : `${prefix}${path}`,
    },
    fireImmediately: true,
  })
  let timer = 0
  try {
    await Promise.race([ready, new Promise<never>((_, reject) => {
      timer = window.setTimeout(() => reject(new Error('timeout')), 15000)
    })])
  } catch {
    throw new Error('このブラウザではバーコード読み取り機能を準備できませんでした。数字を入力してください。')
  } finally {
    window.clearTimeout(timer)
  }
  return new BarcodeDetector({ formats: [...RETAIL_FORMATS] })
}

async function createDetector(): Promise<CodeDetector> {
  const Native = nativeBarcodeDetector()
  if (Native) {
    try {
      const supported = await Native.getSupportedFormats()
      const formats = RETAIL_FORMATS.filter(format => supported.includes(format))
      if (formats.includes('ean_13')) return new Native({ formats: [...formats] })
    } catch { /* Use the bundled reader when the native detector is incomplete. */ }
  }
  return createWasmDetector()
}

let detectorPromise: Promise<CodeDetector> | undefined
function loadDetector(): Promise<CodeDetector> {
  detectorPromise ??= createDetector().catch(error => {
    detectorPromise = undefined
    throw error
  })
  return detectorPromise
}

type TrackCapabilities = MediaTrackCapabilities & { torch?: boolean; focusMode?: string[] }

async function preferRearCamera(stream: MediaStream): Promise<MediaStream> {
  const current = stream.getVideoTracks()[0]
  if (!current) return stream
  const settings = current.getSettings()
  const front = settings.facingMode === 'user' || /front|user|前面|内カメラ/i.test(current.label)
  if (!front) return stream
  try {
    const devices = await navigator.mediaDevices.enumerateDevices()
    const rear = devices.find(device => device.kind === 'videoinput'
      && device.deviceId !== settings.deviceId
      && /back|rear|environment|背面|wide/i.test(device.label))
    if (!rear) return stream
    const next = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { deviceId: { exact: rear.deviceId }, width: { ideal: 1920 }, height: { ideal: 1080 } },
    })
    stream.getTracks().forEach(track => track.stop())
    return next
  } catch {
    return stream
  }
}

async function tuneTrack(track: MediaStreamTrack) {
  const caps = track.getCapabilities?.() as TrackCapabilities | undefined
  const advanced: MediaTrackConstraintSet[] = []
  if (caps?.focusMode?.includes('continuous')) advanced.push({ focusMode: 'continuous' } as MediaTrackConstraintSet)
  if (advanced.length === 0) return
  await track.applyConstraints({ advanced }).catch(() => {})
}

function waitForFrames(video: HTMLVideoElement, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const started = performance.now()
    const tick = () => {
      if (signal?.aborted) {
        reject(new DOMException('Aborted', 'AbortError'))
        return
      }
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        resolve()
        return
      }
      if (performance.now() - started > 5000) {
        reject(new Error('カメラ映像を取得できませんでした。数字を入力してください。'))
        return
      }
      requestAnimationFrame(tick)
    }
    tick()
  })
}

function cropCenter(video: HTMLVideoElement, canvas: HTMLCanvasElement, context: CanvasRenderingContext2D) {
  const width = video.videoWidth
  const height = video.videoHeight
  const cropWidth = Math.max(1, Math.floor(width * 0.9))
  const cropHeight = Math.max(1, Math.floor(height * 0.46))
  const cropX = Math.floor((width - cropWidth) / 2)
  const cropY = Math.floor((height - cropHeight) / 2)
  const scale = Math.min(2, 1400 / cropWidth)
  const targetWidth = Math.max(1, Math.floor(cropWidth * scale))
  const targetHeight = Math.max(1, Math.floor(cropHeight * scale))
  if (canvas.width !== targetWidth) canvas.width = targetWidth
  if (canvas.height !== targetHeight) canvas.height = targetHeight
  context.imageSmoothingEnabled = false
  context.drawImage(video, cropX, cropY, cropWidth, cropHeight, 0, 0, targetWidth, targetHeight)
  return canvas
}

export async function startBarcodeCamera(
  video: HTMLVideoElement,
  incoming: Promise<MediaStream>,
  handlers: CameraHandlers,
): Promise<CameraSession> {
  const signal = handlers.signal
  let stream: MediaStream | undefined
  const release = () => {
    stream?.getTracks().forEach(track => track.stop())
    if (video.srcObject === stream) video.srcObject = null
  }
  try {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    handlers.onStatus?.('カメラを起動しています…')
    stream = await incoming
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    stream = await preferRearCamera(stream)
    const track = stream.getVideoTracks()[0]
    if (track) await tuneTrack(track)
    video.muted = true
    video.playsInline = true
    video.srcObject = stream
    await video.play()
    await waitForFrames(video, signal)
    handlers.onStatus?.('スキャナーを準備しています…')
    let detector = await loadDetector()
    let nativeFailures = 0
    let switchedToWasm = false
    const usingBundledReader = nativeBarcodeDetector() === undefined
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    handlers.onStatus?.('バーコードを枠の中に、水平に合わせてください')

    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d', { willReadFrequently: true })
    let stopped = false
    let timer = 0
    let phase = 0
    let checksumAt = 0

    const stop = () => {
      if (stopped) return
      stopped = true
      window.clearTimeout(timer)
      release()
      stream = undefined
    }
    signal?.addEventListener('abort', stop, { once: true })

    const read = async (source: CanvasImageSource) => {
      try {
        const found = (await detector.detect(source)).map(code => code.rawValue)
        nativeFailures = 0
        return found
      } catch {
        if (usingBundledReader || switchedToWasm || nativeFailures++ < 4) return []
        switchedToWasm = true
        detector = await createWasmDetector()
        detectorPromise = Promise.resolve(detector)
        return (await detector.detect(source)).map(code => code.rawValue)
      }
    }

    const scanOnce = async () => {
      if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || video.videoWidth === 0) return
      const source = phase++ % 2 === 0 || !context ? video : cropCenter(video, canvas, context)
      const values = await read(source)
      for (const raw of values) {
        const interpreted = interpretScan(raw)
        if (interpreted.ok) {
          stop()
          handlers.onCode(interpreted.code)
          return
        }
        if (interpreted.reason === 'checksum' && performance.now() - checksumAt > 1800) {
          checksumAt = performance.now()
          handlers.onStatus?.('数字は読めましたが、チェックデジットが一致しません。明るい場所でもう一度かざしてください。')
        }
      }
    }

    const loop = async () => {
      while (!stopped) {
        const started = performance.now()
        try { await scanOnce() } catch { /* A bad frame should not turn the camera off. */ }
        if (stopped) return
        const delay = Math.max(40, 140 - (performance.now() - started))
        await new Promise<void>(resolve => { timer = window.setTimeout(resolve, delay) })
      }
    }
    void loop()

    const active = () => video.srcObject instanceof MediaStream ? video.srcObject.getVideoTracks()[0] : undefined
    const caps = active()?.getCapabilities?.() as TrackCapabilities | undefined
    return {
      stop,
      torchAvailable: Boolean(caps?.torch),
      setTorch: async on => {
        const live = active()
        if (!live) return
        await live.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] })
      },
    }
  } catch (error) {
    release()
    throw error
  }
}
