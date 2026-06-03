const WS_URL = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`;

// ── Palettes ───────────────────────────────────────────────────────────────
// 8 muted hues. JS sets --hue and --sprite-filter on :root.
// Sepia baseline is ~35deg, so sprite-filter rotates (hue - 35)deg.
const PALETTES = [
  { key: 'slate',    hue: 215, label: 'SLATE'    },
  { key: 'sage',     hue: 148, label: 'SAGE'     },
  { key: 'lavender', hue: 262, label: 'LAVENDER' },
  { key: 'teal',     hue: 175, label: 'TEAL'     },
  { key: 'mauve',    hue: 320, label: 'MAUVE'    },
  { key: 'amber',    hue:  38, label: 'AMBER'    },
  { key: 'terra',    hue:  15, label: 'TERRA'    },
  { key: 'mist',     hue: 195, label: 'MIST'     },
];

const SPRITES = {
  idle:     '/static/assets/kubeling_idle.webm',
  eating:   '/static/assets/kubeling_cheer.webm',
  jiggle:   '/static/assets/kubeling_jiggle.webm',
  sleeping: '/static/assets/kubeling_sleep.webm',
  alert:    '/static/assets/kubeling_alert.webm',
  dead:     '/static/assets/kubeling_end.webm',
};

// ── State ──────────────────────────────────────────────────────────────────
let ws = null;
let selectedHue = PALETTES[0].hue;
let kubeling = { name: '', color: 'slate', fullness: 100, mood: 100, tiredness: 0, sleeping: false, alive: true };
let animTimeout  = null;
let isFlashing   = false;
let _revealReady   = false; // true when video enters last second (or no video)
let _spawnedReady  = false; // true when server sends 'spawned'
let _revealed      = false; // guard — prevent double reveal

// ── DOM refs ───────────────────────────────────────────────────────────────
const screens = {
  onboarding: document.getElementById('screen-onboarding'),
  game:       document.getElementById('screen-game'),
};
const el = {
  bgVideo:         document.getElementById('bg-video'),
  launchText:      document.getElementById('launch-text'),
  launchLine1:     document.getElementById('launch-line-1'),
  launchLine2:     document.getElementById('launch-line-2'),
  nameInput:       document.getElementById('input-name'),
  feedBtn:         document.getElementById('btn-feed'),
  sleepBtn:        document.getElementById('btn-sleep'),
  viewport:        document.getElementById('kubeling-viewport'),
  sprite:          document.getElementById('kubeling-sprite'),
  spriteMain:        document.getElementById('sprite-main'),
  spriteAction:      document.getElementById('sprite-action'),
  spriteVideo:       document.getElementById('sprite-video'),
  spriteImg:         document.getElementById('sprite-img'),
  spritePlaceholder: document.getElementById('sprite-placeholder'),
  zzz:             document.getElementById('zzz'),
  gameName:        document.getElementById('game-name'),
  gameStatus:      document.getElementById('game-status'),
  statBars:        document.getElementById('stat-bars'),
  deathInfo:       document.getElementById('death-info'),
  fullnessBar:     document.getElementById('bar-fullness'),
  fullnessVal:     document.getElementById('val-fullness'),
  moodBar:         document.getElementById('bar-mood'),
  moodVal:         document.getElementById('val-mood'),
  tirednessBar:    document.getElementById('bar-tiredness'),
  tirednessVal:    document.getElementById('val-tiredness'),
  deathCause:      document.getElementById('death-cause'),
  deathLifespan:   document.getElementById('death-lifespan'),
};

// ── Palette ────────────────────────────────────────────────────────────────
function applyPalette(hue) {
  selectedHue = hue;
  const root = document.documentElement;
  root.style.setProperty('--hue', hue);
  // sepia() outputs ~hue 35; rotate to target hue
  const rotate = hue - 35;
  root.style.setProperty('--sprite-filter', `sepia(1) saturate(1.4) hue-rotate(${rotate}deg) brightness(0.95)`);
}

function buildSwatches() {
  const row = document.getElementById('swatch-row');
  PALETTES.forEach((p, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'swatch' + (i === 0 ? ' selected' : '');
    btn.title = p.label;
    btn.style.background = `hsl(${p.hue}, 28%, 50%)`;
    btn.dataset.key = p.key;
    btn.addEventListener('click', () => {
      document.querySelectorAll('.swatch').forEach(s => s.classList.remove('selected'));
      btn.classList.add('selected');
      kubeling.color = p.key;
      applyPalette(p.hue);
    });
    row.appendChild(btn);
  });
}

// ── Screen transitions ─────────────────────────────────────────────────────
function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.remove('active'));
  if (screens[name]) screens[name].classList.add('active');
}

// ── Onboarding submit ──────────────────────────────────────────────────────
document.getElementById('form-onboard').addEventListener('submit', e => {
  e.preventDefault();
  const name = el.nameInput.value.trim();
  if (!name) return;
  kubeling.name = name;
  runSpawnAnimation();
});

function runSpawnAnimation() {
  _revealReady  = false;
  _spawnedReady = false;
  _revealed     = false;

  // Fade out onboarding UI
  screens.onboarding.style.transition = 'opacity 0.5s';
  screens.onboarding.style.opacity = '0';
  setTimeout(() => {
    screens.onboarding.classList.remove('active');
    screens.onboarding.style.cssText = '';
  }, 500);

  connectWebSocket();
  showLaunchText();

  const videoReady = el.bgVideo && !el.bgVideo.error && el.bgVideo.duration > 0;
  if (videoReady) {
    el.bgVideo.play();

    // Trigger game reveal in the last second of the video
    el.bgVideo.addEventListener('timeupdate', function onTick() {
      if (el.bgVideo.duration && el.bgVideo.currentTime >= el.bgVideo.duration - 1) {
        el.bgVideo.removeEventListener('timeupdate', onTick);
        _revealReady = true;
        tryRevealGame();
      }
    });

    // Fade video out after it ends
    el.bgVideo.addEventListener('ended', () => {
      el.bgVideo.style.opacity = '0';
    }, { once: true });

    // Safety valve — reveal after 8s regardless
    setTimeout(() => { _revealReady = true; tryRevealGame(); }, 8000);
  } else {
    setTimeout(() => { _revealReady = true; tryRevealGame(); }, 600);
  }
}

function showLaunchText() {
  el.launchText.style.display = 'flex';
  el.launchLine1.style.opacity = '0';
  el.launchLine2.style.opacity = '0';
  setTimeout(() => el.launchLine1.style.opacity = '1', 600);
  setTimeout(() => el.launchLine2.style.opacity = '1', 2000);
}

function hideLaunchText() {
  el.launchText.style.opacity = '0';
  el.launchText.addEventListener('transitionend', () => {
    el.launchText.style.display = 'none';
  }, { once: true });
}

function tryRevealGame() {
  if (!_revealReady || !_spawnedReady || _revealed) return;
  _revealed = true;
  hideLaunchText();
  screens.game.classList.add('active', 'entering');
  setTimeout(() => screens.game.classList.remove('entering'), 1400);
}

// ── WebSocket ──────────────────────────────────────────────────────────────
function connectWebSocket() {
  ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    ws.send(JSON.stringify({ type: 'spawn', name: kubeling.name, color: kubeling.color }));
  };

  ws.onmessage = ({ data }) => {
    const msg = JSON.parse(data);
    switch (msg.type) {
      case 'spawned':
        applyState(msg);
        _spawnedReady = true;
        tryRevealGame();
        break;
      case 'state':
        applyState(msg);
        break;
      case 'death':
        handleDeath(msg);
        break;
      case 'ping':
        ws.send(JSON.stringify({ type: 'pong' }));
        break;
      case 'error':
        alert(msg.message);
        showScreen('onboarding');
        break;
    }
  };

  ws.onclose = () => {
    if (kubeling.alive) {
      kubeling.alive = false;
      showDeathScreen('disconnected', null, null, null);
    }
  };
}

// ── State ──────────────────────────────────────────────────────────────────
function applyState(msg) {
  kubeling = { ...kubeling, ...msg };
  updateStatBars();
  if (!isFlashing) updateAnimation();
}

function updateStatBars() {
  const f = kubeling.fullness;
  const m = kubeling.mood;
  const t = kubeling.tiredness;
  // Fill is abs-positioned inside a bordered track; width relative to inner area
  el.fullnessBar.style.width = `calc(${f}% - ${(f / 100) * 8}px)`;
  el.fullnessBar.classList.toggle('low', f < 25);
  el.fullnessVal.textContent = Math.round(f);
  el.moodBar.style.width = `calc(${m}% - ${(m / 100) * 8}px)`;
  el.moodBar.classList.toggle('low', m < 25);
  el.moodVal.textContent = Math.round(m);
  el.tirednessBar.style.width = `calc(${t}% - ${(t / 100) * 8}px)`;
  el.tirednessBar.classList.toggle('high', t > 75);
  el.tirednessVal.textContent = Math.round(t);
  el.viewport.classList.toggle('warning', f < 25 || m < 25);
  el.feedBtn.disabled  = kubeling.sleeping || !kubeling.alive;
  el.sleepBtn.disabled = kubeling.sleeping || !kubeling.alive || kubeling.tiredness <= 0;
  el.gameName.textContent = kubeling.name;
}

function updateAnimation() {
  const s = kubeling;
  if (!s.alive)    { setAnim('dead');    return; }
  if (s.sleeping)  { setAnim('sleeping'); return; }
  if (s.fullness < 25 || s.mood < 25 || s.tiredness > 75) { setAnim('alert'); return; }
  setAnim('idle');
}

function setAnim(state) {
  el.sprite.className = state;
  el.zzz.style.display = state === 'sleeping' ? 'block' : 'none';

  const src = SPRITES[state] ?? null;
  const isVideo = src && (src.endsWith('.webm') || src.endsWith('.mp4'));

  if (isVideo) {
    const loops = state === 'idle' || state === 'sleeping' || state === 'alert';
    el.spriteMain.loop = loops;
    // Don't restart a looping animation that's already playing this src
    const alreadyPlaying = el.spriteMain.dataset.src === src && !el.spriteMain.paused;
    if (!alreadyPlaying) {
      if (el.spriteMain.dataset.src !== src) {
        el.spriteMain.src = src;
        el.spriteMain.dataset.src = src;
      }
      el.spriteMain.currentTime = 0;
      el.spriteMain.play().catch(() => {});
    }
    el.spriteMain.style.display = 'block';
    el.spriteImg.style.display = 'none';
    el.spritePlaceholder.style.display = 'none';
    el.spriteMain.onended = (loops || state === 'dead') ? null : () => {
      isFlashing = false;
      updateAnimation();
    };
  } else {
    // No webm yet — show placeholder with CSS animation
    el.spriteMain.onended = null;
    el.spriteMain.pause();
    el.spriteMain.style.display = 'none';
    el.spriteMain.dataset.src = '';
    el.spriteImg.style.display = 'none';
    el.spritePlaceholder.style.display = 'flex';
  }
}

// ── Actions ────────────────────────────────────────────────────────────────
function throwCookie() {
  const vpRect     = el.viewport.getBoundingClientRect();
  const btnRect    = el.feedBtn.getBoundingClientRect();
  const spriteRect = el.sprite.getBoundingClientRect();
  const startX = btnRect.left  - vpRect.left + btnRect.width  / 2;
  const startY = btnRect.top   - vpRect.top  + btnRect.height / 2;
  const endX   = spriteRect.left - vpRect.left + spriteRect.width  / 2;
  const endY   = spriteRect.top  - vpRect.top  + spriteRect.height / 2;
  const flyEl  = document.createElement('img');
  flyEl.src = '/static/assets/cookie_icon.png';
  flyEl.className = 'cookie-throw';
  flyEl.style.left = (startX - 14) + 'px';
  flyEl.style.top  = (startY - 14) + 'px';
  flyEl.style.setProperty('--dx', (endX - startX) + 'px');
  flyEl.style.setProperty('--dy', (endY - startY) + 'px');
  el.viewport.appendChild(flyEl);
  flyEl.addEventListener('animationend', () => flyEl.remove(), { once: true });
}

el.feedBtn.addEventListener('click', e => {
  e.stopPropagation();
  if (!ws || kubeling.sleeping || !kubeling.alive) return;
  ws.send(JSON.stringify({ action: 'feed' }));
  throwCookie();
  flashAnim('eating');
});

el.sleepBtn.addEventListener('click', e => {
  e.stopPropagation();
  if (!ws || kubeling.sleeping || !kubeling.alive) return;
  ws.send(JSON.stringify({ action: 'sleep' }));
});

el.viewport.addEventListener('click', () => {
  if (!ws || kubeling.sleeping || !kubeling.alive) return;
  ws.send(JSON.stringify({ action: 'pet' }));
  flashAnim('jiggle');
  playConfettiOverlay();
});

function playConfettiOverlay() {
  el.spriteVideo.src = '/static/assets/mood_sprite.webm';
  el.spriteVideo.currentTime = 0;
  el.spriteVideo.style.display = 'block';
  el.spriteVideo.play().catch(() => {});
  el.spriteVideo.onended = () => { el.spriteVideo.style.display = 'none'; };
}

function flashAnim(state) {
  clearTimeout(animTimeout);
  isFlashing = true;
  const src = SPRITES[state];
  const isVideo = src && (src.endsWith('.webm') || src.endsWith('.mp4'));
  if (isVideo) {
    playActionAnim(src);
  } else {
    // No webm yet — fall back to CSS animation via setAnim, timeout returns to idle
    if (src) setAnim(state);
    animTimeout = setTimeout(() => { isFlashing = false; updateAnimation(); }, 1500);
  }
}

// Plays a one-shot animation on the overlay element so sprite-main (idle) is never interrupted.
function playActionAnim(src) {
  if (el.spriteAction.getAttribute('src') !== src) {
    el.spriteAction.src = src;
  }
  el.spriteMain.style.opacity = '0';
  el.spriteAction.currentTime = 0;
  el.spriteAction.style.display = 'block';
  el.spriteAction.play().catch(() => {});
  el.spriteAction.onended = () => {
    // Fade sprite-main back in first; keep last frame of action visible during the crossfade
    el.spriteMain.style.opacity = '1';
    el.spriteMain.addEventListener('transitionend', () => {
      el.spriteAction.style.display = 'none';
      isFlashing = false;
      updateAnimation();
    }, { once: true });
  };
}

// ── Death ──────────────────────────────────────────────────────────────────
function handleDeath(msg) {
  kubeling.alive = false;
  setAnim('dead');
  setTimeout(() => showDeathScreen(msg.cause_of_death, msg.lifespan_seconds), 1500);
}

function showDeathScreen(cause, lifespan) {
  const causeMap = { hunger: 'DIED OF HUNGER', boredom: 'DIED OF BOREDOM', disconnected: 'POD TERMINATED', sleep_deprivation: 'WAS DEPRIVED OF SLEEP' };
  el.deathCause.textContent    = kubeling.name + ' ' + (causeMap[cause] ?? 'UNKNOWN');
  el.deathLifespan.textContent = lifespan != null ? formatLifespan(lifespan) : '—';
  el.gameStatus.textContent    = 'DEAD';
  el.statBars.style.display    = 'none';
  el.deathInfo.style.display   = 'flex';
}

function formatLifespan(s) {
  const m = Math.floor(s / 60);
  return m === 0 ? `${s}s` : `${m}m ${s % 60}s`;
}

// ── Play again ─────────────────────────────────────────────────────────────
document.getElementById('btn-play-again').addEventListener('click', () => {
  if (ws) { ws.onclose = null; ws.close(); ws = null; }
  kubeling = { name: '', color: 'slate', fullness: 100, mood: 100, tiredness: 0, sleeping: false, alive: true };
  _revealReady  = false;
  _spawnedReady = false;
  _revealed     = false;
  el.nameInput.value = '';
  el.deathInfo.style.display = 'none';
  el.statBars.style.display  = '';
  el.gameStatus.textContent  = 'ALIVE';
  if (el.bgVideo) {
    el.bgVideo.pause();
    el.bgVideo.currentTime = 0;
    el.bgVideo.style.transition = '';
    el.bgVideo.style.opacity = '0.6';
  }
  el.launchText.style.display = 'none';
  el.launchText.style.opacity = '0';
  showScreen('onboarding');
});

// ── Stars ──────────────────────────────────────────────────────────────────
function buildStars(count = 40) {
  const frag = document.createDocumentFragment();
  for (let i = 0; i < count; i++) {
    const s = document.createElement('div');
    s.className = 'star';
    const size = Math.random() < 0.7 ? 1 : 2; // mostly 1px, some 2px
    s.style.cssText = [
      `width:${size}px`, `height:${size}px`,
      `top:${(Math.random() * 100).toFixed(2)}%`,
      `left:${(Math.random() * 100).toFixed(2)}%`,
      `--dur:${(2 + Math.random() * 4).toFixed(2)}s`,
      `--delay:-${(Math.random() * 5).toFixed(2)}s`, // negative delay = starts mid-cycle
    ].join(';');
    frag.appendChild(s);
  }
  document.body.appendChild(frag);
}

// ── Init ───────────────────────────────────────────────────────────────────
buildStars(120);
buildSwatches();
applyPalette(PALETTES[0].hue);
showScreen('onboarding');

// Preload sprites — action anims go into spriteAction so first frame is decoded in-element
if (SPRITES.eating) {
  el.spriteAction.src = SPRITES.eating;
  el.spriteAction.load();
}
// Remaining videos preloaded via temp elements
Object.values(SPRITES).filter(Boolean).forEach(src => {
  if (src === SPRITES.eating) return; // already handled above
  if (src.endsWith('.webm') || src.endsWith('.mp4')) {
    const v = document.createElement('video');
    v.src = src;
    v.load();
  }
});
