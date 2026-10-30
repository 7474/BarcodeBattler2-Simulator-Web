/**
 * Piezo-style beeps for the handheld reproduction mode.
 * Every tone of the sound effects of finalfighter/BarcodeBattler2-Simulator
 * (src/se/*.mp3) was measured with an FFT over 10 ms windows (pitch, start,
 * length; leading silence removed); the recordings themselves are not bundled.
 * Each tone is [frequency Hz, start ms, length ms].
 */
export type Tone = readonly [number, number, number]

export const SOUNDS = {
  /** A hit, played once as the LEDs run (battle.mp3, 2.5 s). */
  hit: [
    [3678, 0, 60], [5805, 60, 60], [6507, 120, 60], [3120, 180, 60], [3706, 249, 60], [6550, 309, 60],
    [3679, 429, 70], [5805, 499, 60], [6504, 559, 60], [3120, 619, 70], [3709, 688, 60], [6549, 748, 60],
    [3679, 868, 50], [5805, 938, 60], [6503, 998, 60], [3120, 1058, 60], [3708, 1127, 60], [6550, 1187, 60],
    [3679, 1337, 60], [5803, 1407, 60], [6504, 1467, 60], [3120, 1527, 60], [3708, 1596, 60],
    [6551, 1656, 60], [3679, 1776, 60], [5803, 1846, 60], [6503, 1906, 60], [3118, 1966, 60],
    [3709, 2025, 70], [6551, 2095, 60], [3679, 2215, 60], [5803, 2275, 70], [6504, 2345, 60],
    [3120, 2405, 60], [3708, 2464, 60], [6551, 2524, 70],
  ],
  /** A critical hit (battle_critical.mp3). */
  critical: [
    [3679, 0, 60], [5802, 60, 60], [6504, 120, 60], [3120, 180, 70], [3709, 249, 70], [6549, 319, 60],
    [1389, 379, 60], [3681, 439, 60], [5805, 499, 60], [6503, 559, 60], [3120, 619, 70], [3706, 688, 60],
    [6549, 748, 70], [3679, 878, 60], [5803, 938, 60], [6502, 998, 60], [3120, 1058, 70], [3706, 1127, 60],
    [6549, 1187, 70], [1388, 1257, 40], [3679, 1347, 60], [5803, 1407, 60], [6503, 1467, 60],
    [3120, 1527, 70], [3706, 1596, 70], [3480, 1686, 60], [3653, 1746, 70], [3483, 1816, 60],
    [3653, 1876, 70], [6156, 1946, 50], [3483, 1995, 70], [6156, 2085, 40], [3483, 2125, 60],
    [3120, 2185, 70], [6156, 2275, 40], [3117, 2315, 70], [3120, 2434, 80],
  ],
  /** A miss (battle_miss.mp3, 3.2 s). */
  miss: [
    [6623, 0, 60], [5803, 60, 70], [6504, 130, 60], [3120, 190, 60], [3708, 249, 60], [6549, 309, 70],
    [6624, 439, 60], [5803, 499, 60], [6506, 559, 70], [3120, 629, 60], [3708, 688, 60], [6551, 748, 70],
    [6624, 878, 60], [5806, 938, 60], [6503, 998, 70], [3120, 1068, 60], [3706, 1127, 60], [6549, 1187, 70],
    [6624, 1347, 60], [5803, 1407, 60], [6503, 1467, 70], [3120, 1537, 60], [3706, 1596, 60],
    [6549, 1656, 70], [6624, 1786, 60], [5805, 1846, 60], [6504, 1906, 60], [3120, 1966, 70],
    [3708, 2035, 60], [6549, 2095, 70], [6624, 2225, 60], [5803, 2285, 60], [6503, 2345, 60],
    [3120, 2405, 70], [3708, 2474, 60], [6549, 2534, 60], [6621, 2694, 60], [6549, 2814, 70],
    [3708, 2883, 60], [3120, 2943, 60], [6503, 3003, 60], [5803, 3063, 70], [6623, 3133, 60],
    [3292, 3253, 60],
  ],
  /** Turn passes to the other side (change.mp3). */
  change: [
    [3120, 0, 70], [2954, 70, 60], [3898, 130, 60], [3292, 190, 70], [3653, 269, 50],
  ],
  /** Deciding who moves first (decide_first_player.mp3). */
  firstPlayer: [
    [3679, 0, 70], [3679, 130, 60], [5803, 249, 60], [5846, 379, 60], [3303, 439, 70], [5849, 509, 60],
  ],
  /** Battle finished (battle_end.mp3). */
  end: [
    [6503, 0, 60], [3103, 60, 70], [6504, 439, 60], [3101, 499, 70], [6503, 878, 60], [3103, 938, 70],
    [6500, 1317, 60], [3105, 1377, 60], [6503, 1756, 60], [3103, 1816, 60], [3117, 1995, 70],
    [3292, 2185, 70], [3653, 2255, 60], [3120, 2504, 120], [880, 2624, 130], [5803, 2873, 130],
    [6503, 3003, 120], [880, 3293, 80], [3679, 3372, 130], [5803, 3502, 120], [3486, 3622, 220],
  ],
  /** Card accepted, POWER and herbs (card_in_power.mp3). */
  power: [
    [6506, 0, 60], [3106, 60, 70], [6506, 190, 60], [3103, 249, 70], [6503, 379, 60], [3106, 439, 70],
    [6503, 569, 60], [3105, 629, 60], [6504, 758, 60], [3103, 818, 60], [6503, 948, 50], [3103, 998, 70],
    [6502, 1127, 60], [3103, 1187, 70], [6503, 1317, 60], [3103, 1377, 60], [6503, 1507, 60],
    [3105, 1566, 60], [6504, 1696, 60], [3103, 1756, 60],
  ],
  /** Stat change, item broken, non-damage magic (status_down.mp3). */
  statusDown: [
    [6503, 0, 60], [3103, 60, 70], [6506, 439, 60], [3106, 499, 70], [6504, 878, 60], [3106, 938, 70],
    [6506, 1317, 60], [3103, 1377, 60], [6504, 1756, 60], [3105, 1816, 60],
  ],
  /** SET / decide (decide.mp3). */
  decide: [
    [3898, 0, 40], [6503, 60, 50], [3708, 110, 60],
  ],
  /** SELECT (select.mp3). */
  select: [
    [2955, 0, 60], [3120, 60, 60], [5806, 130, 60],
  ],
  /** Power on (on.mp3). */
  on: [
    [2929, 0, 50], [3869, 50, 60], [2926, 110, 70], [3679, 180, 60], [3679, 299, 70], [880, 369, 60],
    [5803, 429, 60], [879, 489, 60], [5846, 549, 60], [3303, 609, 70], [5849, 678, 60], [1472, 738, 60],
    [2923, 838, 60], [3868, 898, 60], [2924, 958, 60], [3679, 1018, 60], [3681, 1147, 60], [880, 1207, 60],
    [5806, 1267, 60], [880, 1327, 70], [5849, 1397, 60], [3300, 1457, 60], [5849, 1517, 70], [1471, 1586, 60],
  ],
  /** Card rejected (card_in_error.mp3). */
  error: [[3869, 0, 120], [3869, 250, 220]],
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
