/* Nano Defender — the engine.
 *
 * You are a Nano S Plus. Waves of hardware attacks come down the die; you
 * shoot countermeasures back. Classic vertical shooter, canvas 2D, neon vector.
 *
 * Classic script, no module, no fetch: the page stays playable under file://.
 * Content (attack types, waves, pickups) lives in waves.js and is never
 * hard-coded here.
 */
(function () {
  'use strict';

  /* logical playfield; every coordinate below is in these units and the
   * canvas is scaled to fit, so the game plays identically at any size */
  var W = 460, H = 700;
  var TAU = Math.PI * 2;

  var STEP = 1 / 120;          // fixed physics step, for determinism
  var MAX_STEPS = 8;           // never simulate more than this per frame
  var HIGH_KEY = 'nano.high';

  var PLAYER = {
    speed: 340, r: 15, y: H - 72,
    fireRate: 0.17, rapidRate: 0.075,
    bulletSpeed: 560, invuln: 1.6
  };

  var D = window.NANO_DATA || { attacks: {}, pickups: {}, waves: [] };

  /* --------------------------------------------------------------- palette
   * Read from :root so assets/style.css stays the only owner of the colours. */
  var C = {};
  function readPalette() {
    var cs = getComputedStyle(document.documentElement);
    ['accent', 'indigo', 'amber', 'pink', 'violet', 'text-1', 'text-2', 'text-3', 'bg']
      .forEach(function (name) {
        C[name] = (cs.getPropertyValue('--' + name) || '').trim() || '#00d4aa';
      });
    C.accent = C.accent || '#00d4aa';
  }

  var reduceMotion = false;

  /* ----------------------------------------------------------------- state */

  var state = {
    phase: 'menu',            // menu | playing | dead | gameover
    paused: false,
    t: 0,                     // seconds since the run started
    score: 0, high: 0,
    lives: 3, shield: 0,
    waveIndex: 0, waveName: '', loop: 0,
    mult: 1,                  // difficulty multiplier, rises each loop
    spread: 0, rapid: 0,      // remaining seconds of each power-up
    leaks: 0, kills: 0,
    shake: 0, flash: 0,
    banner: null,             // { text, sub, t }
    queue: [],                // pending spawns: { at, type, x, y }
    player: null,
    bullets: [], enemies: [], eBullets: [], beams: [], parts: [], pickups: [],
    stars: []
  };

  var els = {};
  var keys = {};
  var pointer = { active: false, x: W / 2 };
  var canvas, ctx, dpr = 1, scale = 1;

  /* -------------------------------------------------------------- helpers */

  function rand(a, b) { return a + Math.random() * (b - a); }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function spawnParts(x, y, color, n, power) {
    if (reduceMotion) n = Math.min(n, 4);
    for (var i = 0; i < n; i++) {
      var a = rand(0, TAU), s = rand(40, 40 + power);
      state.parts.push({
        x: x, y: y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: rand(0.25, 0.6), age: 0, color: color, len: rand(3, 9)
      });
    }
  }

  /* ------------------------------------------------------------ the waves */

  function waveDef(i) {
    var list = D.waves;
    if (!list.length) return null;
    return list[i % list.length];
  }

  function startWave(i) {
    var def = waveDef(i);
    if (!def) return;
    state.loop = Math.floor(i / D.waves.length);
    state.mult = 1 + state.loop * 0.34;
    state.waveIndex = i;
    state.waveName = def.name;
    state.queue = [];

    (def.groups || []).forEach(function (g) {
      var n = g.count, gap = g.gap || 70, after = g.after || 0;
      var cx = W / 2, half = (n - 1) / 2;
      for (var k = 0; k < n; k++) {
        var x = cx, y = -46;
        if (g.formation === 'row' || g.formation === 'vee' || g.formation === 'arc') {
          x = cx + (k - half) * gap;
        } else if (g.formation === 'column') {
          y = -46 - k * gap;
        } else if (g.formation === 'random') {
          x = rand(50, W - 50);
        }
        if (g.formation === 'vee') y = -46 - Math.abs(k - half) * 34;
        if (g.formation === 'arc') y = -46 - (half ? (1 - Math.abs((k - half) / half)) * 56 : 0);
        state.queue.push({
          at: state.t + after + k * (g.delay || 0.25),
          type: g.type, x: clamp(x, 34, W - 34), y: y
        });
      }
    });

    state.banner = {
      text: 'Wave ' + (i + 1),
      sub: def.name + (state.loop ? '  ·  loop ' + (state.loop + 1) : ''),
      t: 0
    };
  }

  function spawnEnemy(type, x, y) {
    var a = D.attacks[type];
    if (!a) return;
    state.enemies.push({
      type: type, def: a,
      x: x, y: y, spawnX: x,
      hp: Math.max(1, Math.round(a.hp * (a.boss ? state.mult : 1 + (state.mult - 1) * 0.6))),
      maxHp: 0, r: a.r,
      t: rand(0, 10),
      cool: (a.cooldown || 2) * rand(0.4, 1) / state.mult,
      charge: 0, hit: 0, phase: 0
    });
    var e = state.enemies[state.enemies.length - 1];
    e.maxHp = e.hp;
  }

  /* ----------------------------------------------------------- game flow */

  function resetRun() {
    state.phase = 'playing';
    state.paused = false;
    state.t = 0;
    state.score = 0; state.lives = 3; state.shield = 0;
    state.spread = 0; state.rapid = 0;
    state.leaks = 0; state.kills = 0;
    state.shake = 0; state.flash = 0;
    state.bullets = []; state.enemies = []; state.eBullets = [];
    state.beams = []; state.parts = []; state.pickups = [];
    state.player = { x: W / 2, y: PLAYER.y, cool: 0, inv: 0, hitFlash: 0 };
    startWave(0);
    renderOverlays();
    renderHud();
  }

  function hitPlayer() {
    var p = state.player;
    if (p.inv > 0) return;
    if (state.shield > 0) {
      state.shield--;
      p.inv = 0.7;
      spawnParts(p.x, p.y, C.indigo, 14, 120);
      renderHud();
      return;
    }
    state.lives--;
    p.inv = PLAYER.invuln;
    p.hitFlash = 0.4;
    state.shake = reduceMotion ? 0 : 14;
    state.flash = 0.35;
    state.spread = 0; state.rapid = 0;
    spawnParts(p.x, p.y, C.pink, 26, 200);
    renderHud();
    if (state.lives <= 0) endRun();
  }

  function killEnemy(e, byPlayer) {
    spawnParts(e.x, e.y, C[e.def.color] || C.accent, e.def.boss ? 70 : 16, e.def.boss ? 320 : 150);
    if (byPlayer) {
      state.score += Math.round(e.def.score * state.mult);
      state.kills++;
      maybeDrop(e);
    }
    if (e.def.boss) { state.shake = reduceMotion ? 0 : 22; state.flash = 0.3; }
    e.dead = true;
    renderHud();
  }

  function maybeDrop(e) {
    var chance = e.def.boss ? 1 : 0.085;
    if (Math.random() > chance) return;
    var names = Object.keys(D.pickups);
    if (!names.length) return;
    /* a life is the rarest drop, and only when you actually need one */
    var pool = names.filter(function (n) {
      return D.pickups[n].effect !== 'life' || state.lives < 3;
    });
    if (!pool.length) pool = names;
    var key = pool[Math.floor(Math.random() * pool.length)];
    state.pickups.push({ key: key, def: D.pickups[key], x: e.x, y: e.y, t: 0, vy: 74 });
  }

  function endRun() {
    state.phase = 'gameover';
    if (state.score > state.high) {
      state.high = state.score;
      try { localStorage.setItem(HIGH_KEY, String(state.high)); } catch (err) { /* private mode */ }
    }
    renderOverlays();
    renderHud();
    els.live.textContent = 'Device compromised. Score ' + state.score +
      ', wave ' + (state.waveIndex + 1) + ', ' + state.kills + ' attacks stopped.';
    if (els.again) els.again.focus({ preventScroll: true });
  }

  /* ---------------------------------------------------------------- update */

  function fire() {
    var p = state.player;
    var rate = state.rapid > 0 ? PLAYER.rapidRate : PLAYER.fireRate;
    if (p.cool > 0) return;
    p.cool = rate;
    var shots = state.spread > 0 ? [-0.2, 0, 0.2] : [0];
    shots.forEach(function (a) {
      state.bullets.push({
        x: p.x, y: p.y - 22,
        vx: Math.sin(a) * PLAYER.bulletSpeed,
        vy: -Math.cos(a) * PLAYER.bulletSpeed
      });
    });
  }

  function enemyShoot(e) {
    var p = state.player;
    var w = e.def.weapon;
    var bs = e.def.bulletSpeed || 180;

    if (w === 'pulse' || w === 'homing') {
      var dx = p.x - e.x, dy = p.y - e.y, d = Math.hypot(dx, dy) || 1;
      state.eBullets.push({
        x: e.x, y: e.y + e.r, vx: dx / d * bs, vy: dy / d * bs,
        r: 4.5, color: e.def.color, homing: w === 'homing', life: 6
      });
    } else if (w === 'ring') {
      for (var i = 0; i < 8; i++) {
        var a = (i / 8) * TAU + e.t;
        state.eBullets.push({
          x: e.x, y: e.y, vx: Math.cos(a) * bs, vy: Math.sin(a) * bs,
          r: 4, color: e.def.color, life: 6
        });
      }
    } else if (w === 'beam') {
      state.beams.push({ x: e.x, t: 0, dur: 0.42, w: 16, color: e.def.color });
    } else if (w === 'boss') {
      e.phase = (e.phase + 1) % 3;
      if (e.phase === 0) {
        for (var k = -3; k <= 3; k++) {
          state.eBullets.push({
            x: e.x, y: e.y + 20, vx: k * 46, vy: 170,
            r: 5, color: e.def.color, life: 6
          });
        }
      } else if (e.phase === 1) {
        state.beams.push({ x: e.x, t: 0, dur: 0.5, w: 22, color: C.violet });
      } else {
        for (var j = 0; j < 12; j++) {
          var b = (j / 12) * TAU;
          state.eBullets.push({
            x: e.x, y: e.y, vx: Math.cos(b) * 140, vy: Math.sin(b) * 140,
            r: 4.5, color: C.amber, life: 6
          });
        }
      }
    }
  }

  function update(dt) {
    state.t += dt;
    var p = state.player;

    /* -- player ------------------------------------------------------- */
    var dir = 0;
    if (keys.left) dir -= 1;
    if (keys.right) dir += 1;
    if (pointer.active) {
      var target = clamp(pointer.x, PLAYER.r, W - PLAYER.r);
      p.x += (target - p.x) * Math.min(1, dt * 14);
    } else {
      p.x += dir * PLAYER.speed * dt;
    }
    p.x = clamp(p.x, PLAYER.r, W - PLAYER.r);

    p.cool = Math.max(0, p.cool - dt);
    p.inv = Math.max(0, p.inv - dt);
    p.hitFlash = Math.max(0, p.hitFlash - dt);
    if (keys.fire || pointer.active) fire();

    if (state.spread > 0) { state.spread -= dt; if (state.spread <= 0) renderHud(); }
    if (state.rapid > 0)  { state.rapid  -= dt; if (state.rapid  <= 0) renderHud(); }
    state.shake = Math.max(0, state.shake - dt * 42);
    state.flash = Math.max(0, state.flash - dt * 2.2);

    /* -- spawn queue -------------------------------------------------- */
    for (var q = state.queue.length - 1; q >= 0; q--) {
      if (state.t >= state.queue[q].at) {
        var s = state.queue[q];
        spawnEnemy(s.type, s.x, s.y);
        state.queue.splice(q, 1);
      }
    }

    /* -- player bullets ----------------------------------------------- */
    for (var i = state.bullets.length - 1; i >= 0; i--) {
      var b = state.bullets[i];
      b.x += b.vx * dt; b.y += b.vy * dt;
      if (b.y < -20 || b.x < -20 || b.x > W + 20) { state.bullets.splice(i, 1); continue; }
      for (var j = 0; j < state.enemies.length; j++) {
        var e = state.enemies[j];
        if (e.dead) continue;
        if (Math.hypot(b.x - e.x, b.y - e.y) < e.r + 3) {
          e.hp--; e.hit = 0.09;
          spawnParts(b.x, b.y, C[e.def.color] || C.accent, 3, 60);
          state.bullets.splice(i, 1);
          if (e.hp <= 0) killEnemy(e, true);
          break;
        }
      }
    }

    /* -- enemies ------------------------------------------------------ */
    for (var m = state.enemies.length - 1; m >= 0; m--) {
      var en = state.enemies[m];
      if (en.dead) { state.enemies.splice(m, 1); continue; }
      en.t += dt;
      en.hit = Math.max(0, en.hit - dt);

      var pat = en.def.pattern, amp = en.def.amp || 0, frq = en.def.freq || 1;
      if (pat === 'zigzag') {
        var ph = (en.t * frq) % 2;
        en.x = en.spawnX + amp * (ph < 1 ? ph * 2 - 1 : 3 - ph * 2) * 0.5;
      } else if (pat === 'sine') {
        en.x = en.spawnX + amp * Math.sin(en.t * frq * TAU);
      } else if (pat === 'drift') {
        en.x = en.spawnX + amp * Math.sin(en.t * frq * TAU) * 1.0;
      }
      en.x = clamp(en.x, en.r, W - en.r);

      /* a boss parks near the top instead of flying past you */
      var speed = en.def.speed * (1 + (state.mult - 1) * 0.4);
      if (en.def.boss) {
        if (en.y < 130) en.y += speed * dt;
      } else {
        en.y += speed * dt;
      }

      /* weapons only once on screen */
      if (en.def.weapon && en.y > 0) {
        en.cool -= dt;
        if (en.def.weapon === 'beam') {
          if (en.cool <= 0 && en.charge === 0) en.charge = 0.0001;
          if (en.charge > 0) {
            en.charge += dt;
            if (en.charge >= (en.def.charge || 1)) {
              enemyShoot(en);
              en.charge = 0;
              en.cool = (en.def.cooldown || 3) / state.mult;
            }
          }
        } else if (en.cool <= 0) {
          enemyShoot(en);
          en.cool = (en.def.cooldown || 2) / state.mult;
        }
      }

      /* a leak enemy is harmless to touch but costs you if it gets past */
      if (en.def.leak) {
        if (en.y > H + en.r) {
          state.leaks++;
          state.lives--;
          state.flash = 0.4;
          state.shake = reduceMotion ? 0 : 12;
          en.dead = true;
          els.live.textContent = 'A side-channel probe got through. Key material leaked.';
          renderHud();
          if (state.lives <= 0) { endRun(); return; }
          continue;
        }
      } else if (en.y > H + en.r + 40) {
        en.dead = true;      // everything else simply leaves
        continue;
      }

      /* ramming */
      if (!en.def.leak && p.inv <= 0 &&
          Math.hypot(p.x - en.x, p.y - en.y) < en.r + PLAYER.r) {
        if (!en.def.boss) { en.hp -= 3; if (en.hp <= 0) killEnemy(en, true); }
        hitPlayer();
        if (state.phase !== 'playing') return;
      }
    }

    /* -- enemy bullets ------------------------------------------------ */
    for (var n = state.eBullets.length - 1; n >= 0; n--) {
      var eb = state.eBullets[n];
      eb.life -= dt;
      if (eb.homing) {
        var hx = p.x - eb.x, hy = p.y - eb.y, hd = Math.hypot(hx, hy) || 1;
        var sp = Math.hypot(eb.vx, eb.vy);
        eb.vx += (hx / hd * sp - eb.vx) * Math.min(1, dt * 1.7);
        eb.vy += (hy / hd * sp - eb.vy) * Math.min(1, dt * 1.7);
      }
      eb.x += eb.vx * dt; eb.y += eb.vy * dt;
      if (eb.life <= 0 || eb.y > H + 30 || eb.y < -30 || eb.x < -30 || eb.x > W + 30) {
        state.eBullets.splice(n, 1); continue;
      }
      if (p.inv <= 0 && Math.hypot(p.x - eb.x, p.y - eb.y) < eb.r + PLAYER.r - 3) {
        state.eBullets.splice(n, 1);
        hitPlayer();
        if (state.phase !== 'playing') return;
      }
    }

    /* -- beams -------------------------------------------------------- */
    for (var v = state.beams.length - 1; v >= 0; v--) {
      var bm = state.beams[v];
      bm.t += dt;
      if (bm.t > bm.dur) { state.beams.splice(v, 1); continue; }
      if (p.inv <= 0 && Math.abs(p.x - bm.x) < bm.w / 2 + PLAYER.r - 4) {
        hitPlayer();
        if (state.phase !== 'playing') return;
      }
    }

    /* -- pickups ------------------------------------------------------ */
    for (var k2 = state.pickups.length - 1; k2 >= 0; k2--) {
      var pu = state.pickups[k2];
      pu.t += dt; pu.y += pu.vy * dt;
      if (pu.y > H + 24) { state.pickups.splice(k2, 1); continue; }
      if (Math.hypot(p.x - pu.x, p.y - pu.y) < PLAYER.r + 16) {
        applyPickup(pu);
        state.pickups.splice(k2, 1);
      }
    }

    /* -- particles ---------------------------------------------------- */
    for (var a2 = state.parts.length - 1; a2 >= 0; a2--) {
      var pt = state.parts[a2];
      pt.age += dt;
      if (pt.age >= pt.life) { state.parts.splice(a2, 1); continue; }
      pt.x += pt.vx * dt; pt.y += pt.vy * dt;
      pt.vx *= 0.985; pt.vy *= 0.985;
    }

    /* -- starfield ---------------------------------------------------- */
    if (!reduceMotion) {
      for (var s2 = 0; s2 < state.stars.length; s2++) {
        var st = state.stars[s2];
        st.y += st.v * dt;
        if (st.y > H) { st.y = -4; st.x = rand(0, W); }
      }
    }

    /* -- banner ------------------------------------------------------- */
    if (state.banner) {
      state.banner.t += dt;
      if (state.banner.t > 2.4) state.banner = null;
    }

    /* -- wave cleared ------------------------------------------------- */
    if (!state.queue.length && !state.enemies.length) {
      state.score += 250 + state.waveIndex * 60;
      startWave(state.waveIndex + 1);
      renderHud();
    }
  }

  function applyPickup(pu) {
    var eff = pu.def.effect;
    if (eff === 'life') state.lives = Math.min(5, state.lives + 1);
    else if (eff === 'spread') state.spread = pu.def.duration || 12;
    else if (eff === 'rapid') state.rapid = pu.def.duration || 10;
    else if (eff === 'shield') state.shield = Math.min(5, state.shield + (pu.def.charges || 3));
    state.score += 120;
    spawnParts(pu.x, pu.y, C[pu.def.color] || C.accent, 12, 90);
    els.live.textContent = pu.def.label + ' picked up.';
    flashToast(pu.def.label, pu.def.color);
    renderHud();
  }

  /* ----------------------------------------------------------------- draw */

  function neon(color, blur) {
    ctx.strokeStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = reduceMotion ? 0 : (blur == null ? 10 : blur);
  }

  function drawShip(p) {
    var blink = p.inv > 0 && Math.floor(p.inv * 14) % 2 === 0;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.lineWidth = 2;
    ctx.globalAlpha = blink ? 0.32 : 1;

    var body = p.hitFlash > 0 ? C.pink : C.accent;

    /* thruster */
    if (!reduceMotion) {
      var f = 8 + Math.sin(state.t * 30) * 4;
      neon(C.amber, 14);
      ctx.globalAlpha *= 0.75;
      ctx.beginPath();
      ctx.moveTo(-5, 22); ctx.lineTo(0, 22 + f); ctx.lineTo(5, 22);
      ctx.stroke();
      ctx.globalAlpha = blink ? 0.32 : 1;
    }

    /* body: the Nano S Plus shell */
    neon(body, 12);
    ctx.beginPath();
    ctx.moveTo(-13, -14);
    ctx.lineTo(-13, 20);
    ctx.quadraticCurveTo(-13, 23, -10, 23);
    ctx.lineTo(10, 23);
    ctx.quadraticCurveTo(13, 23, 13, 20);
    ctx.lineTo(13, -14);
    ctx.stroke();

    /* the steel cover, narrower, over the top */
    ctx.beginPath();
    ctx.moveTo(-9, -14);
    ctx.lineTo(-9, -26);
    ctx.quadraticCurveTo(-9, -29, -6, -29);
    ctx.lineTo(6, -29);
    ctx.quadraticCurveTo(9, -29, 9, -26);
    ctx.lineTo(9, -14);
    ctx.closePath();
    ctx.stroke();

    /* the two buttons, at the nose */
    neon(C['text-2'], 6);
    ctx.beginPath(); ctx.arc(-4, -32, 1.9, 0, TAU); ctx.stroke();
    ctx.beginPath(); ctx.arc(4, -32, 1.9, 0, TAU); ctx.stroke();

    /* the screen */
    neon(C.amber, 10);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.rect(-8, -8, 16, 11);
    ctx.stroke();
    ctx.fillStyle = 'rgba(251,191,36,0.16)';
    ctx.shadowBlur = 0;
    ctx.fillRect(-8, -8, 16, 11);

    /* shield ring */
    if (state.shield > 0) {
      ctx.lineWidth = 1.5;
      neon(C.indigo, 14);
      ctx.globalAlpha *= 0.55 + Math.sin(state.t * 6) * 0.12;
      ctx.beginPath();
      ctx.arc(0, -2, 30, 0, TAU);
      ctx.stroke();
    }

    ctx.restore();
  }

  function drawEnemy(e) {
    var col = e.hit > 0 ? C['text-1'] : (C[e.def.color] || C.accent);
    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.lineWidth = 2;
    neon(col, e.def.boss ? 22 : 11);

    var r = e.r, t = e.t;

    if (e.type === 'glitch') {
      /* a clipped square wave: the dropped supply rail */
      ctx.beginPath();
      ctx.moveTo(-r, -r * 0.4);
      ctx.lineTo(-r * 0.3, -r * 0.4);
      ctx.lineTo(-r * 0.3, r * 0.7);
      ctx.lineTo(r * 0.3, r * 0.7);
      ctx.lineTo(r * 0.3, -r * 0.4);
      ctx.lineTo(r, -r * 0.4);
      ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.globalAlpha = 0.35; ctx.stroke();

    } else if (e.type === 'emfi') {
      /* a coil: concentric arcs */
      for (var i = 0; i < 3; i++) {
        ctx.globalAlpha = 1 - i * 0.22;
        ctx.beginPath();
        ctx.arc(0, 0, r - i * 4, t * 2 + i, t * 2 + i + Math.PI * 1.4);
        ctx.stroke();
      }

    } else if (e.type === 'probe') {
      /* a needle with a listening antenna */
      ctx.beginPath();
      ctx.moveTo(0, -r); ctx.lineTo(0, r);
      ctx.moveTo(-r * 0.6, -r * 0.2); ctx.lineTo(0, -r * 0.6); ctx.lineTo(r * 0.6, -r * 0.2);
      ctx.stroke();
      ctx.globalAlpha = 0.4 + Math.sin(t * 8) * 0.25;
      ctx.beginPath(); ctx.arc(0, r * 0.4, r * 0.55, 0, TAU); ctx.stroke();

    } else if (e.type === 'laser') {
      /* a lens housing; it glows while charging */
      ctx.beginPath(); ctx.rect(-r * 0.8, -r * 0.8, r * 1.6, r * 1.2); ctx.stroke();
      ctx.beginPath(); ctx.arc(0, r * 0.45, r * 0.42, 0, TAU); ctx.stroke();
      if (e.charge > 0) {
        var k = e.charge / (e.def.charge || 1);
        ctx.globalAlpha = 0.25 + k * 0.6;
        ctx.lineWidth = 1 + k * 2;
        ctx.beginPath(); ctx.moveTo(0, r); ctx.lineTo(0, H); ctx.stroke();
      }

    } else if (e.type === 'jtag') {
      /* a 2x5 header */
      ctx.beginPath(); ctx.rect(-r * 0.9, -r * 0.55, r * 1.8, r * 1.1); ctx.stroke();
      ctx.lineWidth = 1.4;
      for (var c = 0; c < 5; c++) {
        var px = -r * 0.62 + c * (r * 0.31);
        ctx.beginPath();
        ctx.moveTo(px, -r * 0.25); ctx.lineTo(px, -r * 0.05);
        ctx.moveTo(px, r * 0.05); ctx.lineTo(px, r * 0.25);
        ctx.stroke();
      }

    } else if (e.def.boss) {
      /* the decap rig: an outer frame, a rotating probe carousel, the die */
      ctx.beginPath(); ctx.rect(-r, -r * 0.7, r * 2, r * 1.4); ctx.stroke();
      ctx.globalAlpha = 0.5;
      ctx.beginPath(); ctx.rect(-r * 1.15, -r * 0.85, r * 2.3, r * 1.7); ctx.stroke();
      ctx.globalAlpha = 1;
      for (var a = 0; a < 6; a++) {
        var ang = t * 0.9 + (a / 6) * TAU;
        ctx.beginPath();
        ctx.moveTo(Math.cos(ang) * r * 0.45, Math.sin(ang) * r * 0.35);
        ctx.lineTo(Math.cos(ang) * r * 0.95, Math.sin(ang) * r * 0.62);
        ctx.stroke();
      }
      neon(C.amber, 18);
      ctx.beginPath(); ctx.rect(-r * 0.3, -r * 0.22, r * 0.6, r * 0.44); ctx.stroke();

    } else {
      ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.stroke();
    }

    ctx.restore();

    /* boss health bar, pinned to the top of the playfield */
    if (e.def.boss) {
      var frac = Math.max(0, e.hp / e.maxHp);
      ctx.save();
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(255,255,255,0.07)';
      ctx.fillRect(40, 16, W - 80, 4);
      ctx.fillStyle = C.pink;
      ctx.shadowColor = C.pink;
      ctx.shadowBlur = reduceMotion ? 0 : 12;
      ctx.fillRect(40, 16, (W - 80) * frac, 4);
      ctx.restore();
    }
  }

  function draw() {
    var sx = 0, sy = 0;
    if (state.shake > 0.2) {
      sx = rand(-state.shake, state.shake) * 0.5;
      sy = rand(-state.shake, state.shake) * 0.5;
    }

    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * sx, dpr * sy);
    ctx.clearRect(-20, -20, W + 40, H + 40);

    /* starfield */
    ctx.shadowBlur = 0;
    for (var i = 0; i < state.stars.length; i++) {
      var st = state.stars[i];
      ctx.globalAlpha = st.a;
      ctx.fillStyle = C['text-3'];
      ctx.fillRect(st.x, st.y, 1.4, st.len);
    }
    ctx.globalAlpha = 1;

    if (state.phase === 'playing' || state.phase === 'gameover') {
      /* beams behind everything else */
      state.beams.forEach(function (b) {
        var k = 1 - b.t / b.dur;
        ctx.save();
        ctx.globalAlpha = 0.25 + k * 0.5;
        ctx.fillStyle = b.color === C.violet ? C.violet : (C[b.color] || C.violet);
        ctx.shadowColor = ctx.fillStyle;
        ctx.shadowBlur = reduceMotion ? 0 : 24;
        ctx.fillRect(b.x - b.w / 2, 0, b.w, H);
        ctx.restore();
      });

      state.parts.forEach(function (p) {
        var k = 1 - p.age / p.life;
        ctx.save();
        ctx.globalAlpha = k;
        ctx.lineWidth = 1.6;
        neon(p.color, 8);
        var nx = p.vx, ny = p.vy, nd = Math.hypot(nx, ny) || 1;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - nx / nd * p.len, p.y - ny / nd * p.len);
        ctx.stroke();
        ctx.restore();
      });

      state.pickups.forEach(function (pu) {
        var col = C[pu.def.color] || C.accent;
        ctx.save();
        ctx.translate(pu.x, pu.y);
        ctx.rotate(pu.t * 1.4);
        ctx.lineWidth = 2;
        neon(col, 14);
        ctx.beginPath();
        ctx.rect(-8, -8, 16, 16);
        ctx.stroke();
        ctx.rotate(-pu.t * 1.4);
        ctx.globalAlpha = 0.85;
        ctx.beginPath(); ctx.arc(0, 0, 3, 0, TAU); ctx.stroke();
        ctx.restore();
      });

      state.enemies.forEach(drawEnemy);

      ctx.lineWidth = 2;
      state.bullets.forEach(function (b) {
        ctx.save();
        neon(C.accent, 12);
        ctx.beginPath();
        ctx.moveTo(b.x, b.y);
        ctx.lineTo(b.x - b.vx * 0.016, b.y - b.vy * 0.016);
        ctx.stroke();
        ctx.restore();
      });

      state.eBullets.forEach(function (b) {
        var col = C[b.color] || C.pink;
        ctx.save();
        ctx.lineWidth = 2;
        neon(col, 12);
        ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, TAU); ctx.stroke();
        ctx.restore();
      });

      if (state.phase === 'playing') drawShip(state.player);
    }

    /* wave banner */
    if (state.banner) {
      var bt = state.banner.t;
      var alpha = bt < 0.3 ? bt / 0.3 : (bt > 1.8 ? Math.max(0, (2.4 - bt) / 0.6) : 1);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.textAlign = 'center';
      ctx.shadowColor = C.accent;
      ctx.shadowBlur = reduceMotion ? 0 : 18;
      ctx.fillStyle = C['text-1'];
      ctx.font = '600 26px Inter, system-ui, sans-serif';
      ctx.fillText(state.banner.text, W / 2, H * 0.4);
      ctx.shadowBlur = 0;
      ctx.fillStyle = C.accent;
      ctx.font = "500 11px 'JetBrains Mono', monospace";
      ctx.fillText(state.banner.sub.toUpperCase(), W / 2, H * 0.4 + 24);
      ctx.restore();
    }

    /* damage flash */
    if (state.flash > 0.01) {
      ctx.save();
      ctx.shadowBlur = 0;
      ctx.globalAlpha = Math.min(0.5, state.flash);
      ctx.fillStyle = C.pink;
      ctx.fillRect(-20, -20, W + 40, H + 40);
      ctx.restore();
    }
  }

  /* ------------------------------------------------------------ the loop */

  var rafId = null, lastTs = 0, acc = 0;

  function frame(ts) {
    rafId = requestAnimationFrame(frame);

    /* lastTs 0 means a fresh or resumed clock: this frame consumes no time,
     * which is how pause and tab-blur avoid a catch-up burst */
    if (!lastTs) { lastTs = ts; return; }
    var dt = (ts - lastTs) / 1000;
    lastTs = ts;
    if (dt > 0.25) dt = 0.25;

    if (state.phase === 'playing' && !state.paused) {
      acc += dt;
      var steps = 0;
      while (acc >= STEP && steps < MAX_STEPS) {
        update(STEP);
        acc -= STEP;
        steps++;
        if (state.phase !== 'playing') { acc = 0; break; }
      }
      if (steps >= MAX_STEPS) acc = 0;
    } else if (!reduceMotion) {
      /* keep the starfield alive on the menu and the game-over screen */
      for (var i = 0; i < state.stars.length; i++) {
        var st = state.stars[i];
        st.y += st.v * dt * 0.4;
        if (st.y > H) { st.y = -4; st.x = rand(0, W); }
      }
    }

    draw();
  }

  function startLoop() { lastTs = 0; acc = 0; if (!rafId) rafId = requestAnimationFrame(frame); }
  function stopLoop() { if (rafId) cancelAnimationFrame(rafId); rafId = null; lastTs = 0; }

  function setPaused(on) {
    if (state.phase !== 'playing') { state.paused = false; els.veil.hidden = true; return; }
    state.paused = on;
    lastTs = 0; acc = 0;
    els.veil.hidden = !on;
  }

  /* ------------------------------------------------------------------ HUD */

  var toastTimer = null;
  function flashToast(text, colorName) {
    els.toast.textContent = text;
    els.toast.style.color = C[colorName] || C.accent;
    els.toast.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { els.toast.hidden = true; }, 1500);
  }

  function pips(node, count, total, cls) {
    node.replaceChildren();
    for (var i = 0; i < total; i++) {
      node.appendChild(el('span', cls + (i < count ? '' : ' is-off')));
    }
  }

  function renderHud() {
    els.score.textContent = String(state.score);
    els.wave.textContent = String(state.waveIndex + 1);
    els.high.textContent = 'High ' + Math.max(state.high, state.score);

    pips(els.lives, state.lives, Math.max(3, state.lives), 'pip');
    els.lives.setAttribute('aria-label',
      state.lives + (state.lives === 1 ? ' life left' : ' lives left'));

    els.shield.hidden = state.shield <= 0;
    if (state.shield > 0) pips(els.shieldPips, state.shield, state.shield, 'pip is-shield');

    var buffs = [];
    if (state.spread > 0) buffs.push('Clear signing ' + Math.ceil(state.spread) + 's');
    if (state.rapid > 0) buffs.push('Attestation ' + Math.ceil(state.rapid) + 's');
    els.buffs.textContent = buffs.join('  ·  ');
  }

  function renderOverlays() {
    els.menu.classList.toggle('is-hidden', state.phase !== 'menu');
    els.over.classList.toggle('is-hidden', state.phase !== 'gameover');
    els.hud.classList.toggle('is-hidden', state.phase === 'menu');

    if (state.phase === 'gameover') {
      els.overStats.replaceChildren();
      [['Score', String(state.score)],
       ['Wave', String(state.waveIndex + 1)],
       ['Attacks stopped', String(state.kills)],
       ['Best', String(state.high)]].forEach(function (pair) {
        var s = el('div', 'stat');
        s.appendChild(el('b', null, pair[1]));
        s.appendChild(el('span', null, pair[0]));
        els.overStats.appendChild(s);
      });
      els.overTitle.textContent = state.score >= state.high && state.score > 0
        ? 'New best' : 'Device compromised';
      els.overLine.textContent = state.leaks
        ? 'Reached wave ' + (state.waveIndex + 1) + '. ' + state.leaks +
          (state.leaks === 1 ? ' probe' : ' probes') + ' got through — shoot those first, they never shoot back.'
        : 'Reached wave ' + (state.waveIndex + 1) + ' and stopped ' + state.kills + ' attacks.';
    }
  }

  /* ---------------------------------------------------------------- input */

  function onKeyDown(e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target && e.target.closest && e.target.closest('button')) {
      /* let the button handle its own Enter/Space */
      if (e.key === 'Enter' || e.key === ' ') return;
    }
    var k = e.key.toLowerCase();

    if (k === 'arrowleft' || k === 'a' || k === 'q') { keys.left = true; e.preventDefault(); }
    if (k === 'arrowright' || k === 'd') { keys.right = true; e.preventDefault(); }
    if (k === ' ') { keys.fire = true; e.preventDefault(); }

    if (k === 'p' && state.phase === 'playing') { e.preventDefault(); setPaused(!state.paused); }
    if ((k === 'enter' || k === ' ') && state.phase !== 'playing') { e.preventDefault(); resetRun(); }
    if (k === 'r' && state.phase === 'gameover') { e.preventDefault(); resetRun(); }
  }

  function onKeyUp(e) {
    var k = e.key.toLowerCase();
    if (k === 'arrowleft' || k === 'a' || k === 'q') keys.left = false;
    if (k === 'arrowright' || k === 'd') keys.right = false;
    if (k === ' ') keys.fire = false;
  }

  function pointerX(ev) {
    var rect = canvas.getBoundingClientRect();
    return (ev.clientX - rect.left) / rect.width * W;
  }

  /* --------------------------------------------------------------- resize */

  function resize() {
    var box = canvas.parentElement.getBoundingClientRect();
    /* Three limits, and the tightest wins: the container, the logical width
     * (never upscale past 1:1, it only softens the strokes), and whatever
     * height is left on screen so the playfield never needs scrolling. */
    var maxH = Math.max(340, window.innerHeight - 210);
    var cssW = Math.max(240, Math.min(box.width, W, maxH * (W / H)));
    var cssH = cssW * (H / W);

    dpr = Math.min(window.devicePixelRatio || 1, 2);
    scale = cssW / W;
    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
  }

  /* ----------------------------------------------------------------- boot */

  function boot() {
    [['canvas', 'stage'], ['hud', 'hud'], ['score', 'hud-score'], ['wave', 'hud-wave'],
     ['lives', 'hud-lives'], ['shield', 'hud-shield'], ['shieldPips', 'hud-shield-pips'],
     ['buffs', 'hud-buffs'], ['high', 'foot-high'], ['toast', 'toast'],
     ['menu', 'panel-menu'], ['over', 'panel-over'], ['veil', 'paused-veil'],
     ['start', 'btn-start'], ['again', 'btn-again'],
     ['overTitle', 'over-title'], ['overLine', 'over-line'], ['overStats', 'over-stats'],
     ['live', 'live'], ['legend', 'legend']
    ].forEach(function (p) { els[p[0]] = document.getElementById(p[1]); });

    canvas = els.canvas;
    ctx = canvas.getContext('2d');

    readPalette();
    try {
      var mq = window.matchMedia('(prefers-reduced-motion: reduce)');
      reduceMotion = mq.matches;
      mq.addEventListener('change', function (e) { reduceMotion = e.matches; });
    } catch (e) { /* older browsers */ }

    try { state.high = parseInt(localStorage.getItem(HIGH_KEY), 10) || 0; }
    catch (e) { state.high = 0; }

    for (var i = 0; i < 46; i++) {
      state.stars.push({ x: rand(0, W), y: rand(0, H), v: rand(14, 60), a: rand(0.12, 0.5), len: rand(3, 11) });
    }

    buildLegend();
    resize();
    window.addEventListener('resize', resize);

    els.start.addEventListener('click', resetRun);
    els.again.addEventListener('click', resetRun);
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);

    canvas.addEventListener('pointerdown', function (ev) {
      if (state.phase !== 'playing') return;
      canvas.setPointerCapture(ev.pointerId);
      pointer.active = true; pointer.x = pointerX(ev);
      ev.preventDefault();
    });
    canvas.addEventListener('pointermove', function (ev) {
      if (pointer.active) pointer.x = pointerX(ev);
    });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (n) {
      canvas.addEventListener(n, function () { pointer.active = false; });
    });

    document.addEventListener('visibilitychange', function () {
      if (document.hidden) { setPaused(true); stopLoop(); }
      else { setPaused(false); startLoop(); }
    });
    window.addEventListener('blur', function () { setPaused(true); });

    renderOverlays();
    renderHud();
    startLoop();
  }

  /* the legend doubles as the menu's "know your enemy" table */
  function buildLegend() {
    if (!els.legend) return;
    els.legend.replaceChildren();
    Object.keys(D.attacks).forEach(function (key) {
      var a = D.attacks[key];
      var row = el('div', 'legend-row' + (a.boss ? ' is-boss' : ''));
      var sw = el('span', 'legend-swatch');
      sw.style.background = C[a.color] || C.accent;
      sw.style.boxShadow = '0 0 10px ' + (C[a.color] || C.accent);
      row.appendChild(sw);
      var txt = el('div', 'legend-text');
      txt.appendChild(el('b', null, a.label));
      txt.appendChild(el('span', null, a.hint));
      row.appendChild(txt);
      els.legend.appendChild(row);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.NANO = state;   // for poking at it in the console
})();
