/* Nano Defender — the content.
 *
 * Pure data, no logic, loaded as a classic script so the page works under
 * file:// too. Tune the game here; the engine in game.js reads it and should
 * not need changing to add an attack type or a wave.
 *
 * Colours are token names resolved against :root in game.js, so the palette
 * stays owned by assets/style.css.
 */
window.NANO_DATA = {

  /* ---------------------------------------------------------------- attacks
   * hp        hits to kill
   * r         collision radius, px
   * speed     downward drift, px/s
   * score     points on kill
   * pattern   how it moves sideways: 'straight' | 'zigzag' | 'sine' | 'drift'
   * amp/freq  pattern shape
   * weapon    null | 'pulse' | 'beam' | 'ring' | 'homing'
   * cooldown  seconds between shots
   * leak      true = harmless to touch, but costs you if it reaches the bottom
   */
  attacks: {
    glitch: {
      label: 'Voltage glitch',
      hint: 'Drops the supply rail for a microsecond to skip an instruction.',
      hp: 1, r: 13, speed: 62, score: 100, color: 'amber',
      pattern: 'zigzag', amp: 70, freq: 1.7,
      weapon: 'pulse', cooldown: 2.2, bulletSpeed: 210
    },
    emfi: {
      label: 'EM fault injection',
      hint: 'A coil pulses a field over the die. No contact, no trace.',
      hp: 2, r: 15, speed: 46, score: 180, color: 'accent',
      pattern: 'sine', amp: 110, freq: 0.8,
      weapon: 'ring', cooldown: 3.4, bulletSpeed: 130
    },
    probe: {
      label: 'Side-channel probe',
      hint: 'Never touches you. It listens to power draw until the key leaks.',
      hp: 1, r: 12, speed: 88, score: 140, color: 'pink',
      pattern: 'sine', amp: 60, freq: 1.2,
      weapon: null, leak: true
    },
    laser: {
      label: 'Laser fault injection',
      hint: 'Charges, then fires straight down. Do not be underneath it.',
      hp: 3, r: 17, speed: 34, score: 260, color: 'violet',
      pattern: 'drift', amp: 40, freq: 0.5,
      weapon: 'beam', cooldown: 3.8, charge: 1.1
    },
    jtag: {
      label: 'JTAG probe',
      hint: 'Slow, armoured, and its debug pulses follow you.',
      hp: 5, r: 19, speed: 28, score: 340, color: 'indigo',
      pattern: 'straight',
      weapon: 'homing', cooldown: 2.9, bulletSpeed: 150
    },
    decap: {
      label: 'Decapsulation rig',
      hint: 'Acid off the package, probes on the bare die. Everything at once.',
      hp: 46, r: 44, speed: 12, score: 3000, color: 'pink',
      pattern: 'drift', amp: 120, freq: 0.32,
      weapon: 'boss', cooldown: 1.5, boss: true
    }
  },

  /* --------------------------------------------------------------- pickups
   * Dropped by kills. Each one is a real countermeasure. */
  pickups: {
    retry:     { label: 'PIN retry counter', color: 'accent', effect: 'life' },
    clearsign: { label: 'Clear signing',     color: 'amber',  effect: 'spread', duration: 14 },
    busenc:    { label: 'Bus encryption',    color: 'indigo', effect: 'shield', charges: 3 },
    attest:    { label: 'Attestation',       color: 'violet', effect: 'rapid',  duration: 11 }
  },

  /* ------------------------------------------------------------------ waves
   * Each entry: { type, count, formation, gap, delay, after }
   *   formation: 'row' | 'vee' | 'column' | 'arc' | 'random'
   *   gap        spacing between members, px
   *   delay      seconds between members appearing
   *   after      seconds to wait before this group starts
   * The engine loops these with a rising difficulty multiplier once the
   * scripted list runs out, so the game is endless. */
  waves: [
    { name: 'Power rail', groups: [
      { type: 'glitch', count: 5, formation: 'row', gap: 74, delay: 0.25 }
    ]},
    { name: 'Listening', groups: [
      { type: 'glitch', count: 4, formation: 'vee', gap: 62, delay: 0.2 },
      { type: 'probe',  count: 3, formation: 'row', gap: 96, delay: 0.35, after: 2.4 }
    ]},
    { name: 'Field work', groups: [
      { type: 'emfi',   count: 4, formation: 'arc', gap: 78, delay: 0.3 },
      { type: 'glitch', count: 6, formation: 'row', gap: 60, delay: 0.18, after: 3.2 }
    ]},
    { name: 'Optical', groups: [
      { type: 'laser',  count: 2, formation: 'row', gap: 150, delay: 0.8 },
      { type: 'probe',  count: 4, formation: 'random', gap: 70, delay: 0.5, after: 2.0 },
      { type: 'glitch', count: 5, formation: 'vee', gap: 58, delay: 0.16, after: 4.5 }
    ]},
    { name: 'Debug port', groups: [
      { type: 'jtag',   count: 2, formation: 'row', gap: 160, delay: 1.0 },
      { type: 'emfi',   count: 3, formation: 'arc', gap: 84, delay: 0.3, after: 2.6 },
      { type: 'glitch', count: 6, formation: 'row', gap: 56, delay: 0.14, after: 5.0 }
    ]},
    { name: 'Bare die', boss: true, groups: [
      { type: 'decap',  count: 1, formation: 'row', gap: 0, delay: 0 },
      { type: 'glitch', count: 4, formation: 'row', gap: 90, delay: 0.3, after: 6.0 },
      { type: 'probe',  count: 3, formation: 'random', gap: 80, delay: 0.5, after: 13.0 }
    ]}
  ]
};
