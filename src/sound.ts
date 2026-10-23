/**
 * Piezo-style beeps for the handheld reproduction mode.
 * Pitches and rhythms were measured from the sound effects of
 * finalfighter/BarcodeBattler2-Simulator (src/se/*.mp3); those recordings are
 * not bundled. Each tone is [frequency Hz, start ms, length ms].
 */
export type Tone = readonly [number, number, number]

export const SOUNDS = {
  /** One 400 ms LED sweep of a hit (battle.mp3). */
  hit: [[3120, 0, 60], [3708, 60, 60], [6550, 120, 50]],
  /** One sweep of a critical hit (battle_critical.mp3). */
  critical: [[3120, 0, 60], [3708, 60, 65], [3680, 270, 50]],
  /** One sweep of a miss (battle_miss.mp3). */
  miss: [[6550, 0, 50]],
  /** Turn passes to the other side (change.mp3). */
  change: [[3120, 0, 60], [3292, 180, 70]],
  /** Card accepted, POWER and herbs (card_in_power.mp3). */
  power: Array.from({ length: 10 }, (_, i) => [[6506, i * 190, 60], [3106, i * 190 + 60, 70]] as const).flat(),
  /** Card rejected (card_in_error.mp3). */
  error: [[3869, 0, 120], [3869, 250, 220]],
  /** SET / decide (decide.mp3). */
  decide: [[3898, 0, 40], [6503, 60, 50], [3708, 110, 60]],
  /** SELECT (select.mp3). */
  select: [[3120, 0, 50]],
  /** Stat change, item broken, non-damage magic (status_down.mp3). */
  statusDown: Array.from({ length: 5 }, (_, i) => [[6506, i * 440, 60], [3106, i * 440 + 60, 70]] as const).flat(),
  /** Battle finished (battle_end.mp3, without its leading silence). */
  end: [[3117, 0, 50], [3292, 180, 60], [3120, 490, 120]],
  /** Power on (on.mp3). */
  on: [[5846, 0, 60], [3303, 60, 70], [5849, 130, 50], [5849, 850, 60], [3300, 910, 60], [5849, 970, 60]],
} satisfies Record<string, readonly Tone[]>

let audio: AudioContext | undefined
let enabled = true

export function setSoundEnabled(value: boolean) { enabled = value }
export function soundEnabled() { return enabled }

/** Create or resume the AudioContext inside a user gesture. */
export function unlockAudio() {
  try {
    audio ??= new AudioContext()
    void audio.resume()
  } catch { /* Sound is optional. */ }
}

/** Play tones; `scale` stretches the rhythm (not the pitch) for battle speed. */
export function playTones(tones: readonly Tone[], scale = 1, volume = 0.035) {
  if (!audio || !enabled) return
  const now = audio.currentTime
  for (const [frequency, start, length] of tones) {
    const at = now + start * scale / 1000
    const osc = audio.createOscillator()
    const gain = audio.createGain()
    osc.type = 'square'
    osc.frequency.setValueAtTime(frequency, at)
    gain.gain.setValueAtTime(0, now)
    gain.gain.setValueAtTime(volume, at)
    gain.gain.setValueAtTime(0, at + length / 1000)
    osc.connect(gain).connect(audio.destination)
    osc.start(at)
    osc.stop(at + length / 1000 + 0.01)
  }
}

/** The simple beep used by the standard display mode. */
export function beep(frequency = 1760, length = 0.08) {
  if (!audio || !enabled) return
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
