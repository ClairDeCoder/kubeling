const WS_URL = `ws://${window.location.host}/ws`;

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
  idle:     'sprites/idle.gif',
  eating:   'sprites/eat.gif',
  sleeping: 'sprites/sleep.gif',
  confetti: 'sprites/confetti.gif',
  crying:   'sprites/cry.gif',
};

// ── State ──────────────────────────────────────────────────────────────────
let ws = null;
let selectedHue = PALETTES[0].hue;
let kubeling = { name: '', color: 'slate', fullness: 100, mood: 100, sleeping: false, alive: true };
let animTimeout = null;

// ── DOM refs ───────────────────────────────────────────────────────────────
const screens = {
  onboarding: document.getElementById('screen-onboarding'),
  game:       document.getElementById('screen-game'),
  death:      document.getElementById('screen-death'),
};
const el = {
  bgVideo:         document.getElementById('bg-video'),
  nameInput:       document.getElementById('input-name'),
  feedBtn:         document.getElementById('btn-feed'),
  viewport:        document.getElementById('kubeling-viewport'),
  sprite:          document.getElementById('kubeling-sprite'),
  spriteImg:       document.getElementById('sprite-img'),
  spritePlaceholder: document.getElementById('sprite-placeholder'),
  zzz:             document.getElementById('zzz'),
  gameName:        document.getElementById('game-name'),
  fullnessBar:     document.getElementById('bar-fullness'),
  fullnessVal:     document.getElementById('val-fullness'),
  moodBar:         document.getElementById('bar-mood'),
  moodVal:         document.getElementById('val-mood'),
  deathName:       document.getElementById('death-name'),
  deathCause:      document.getElementById('death-cause'),
  deathLifespan:   document.getElementById('death-lifespan'),
  deathPeakFull:   document.getElementById('death-peak-fullness'),
  deathPeakMood:   document.getElementById('death-peak-mood'),
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
  // Check if the video asset actually loaded (src resolved, no error, has duration)
  const videoReady = el.bgVideo && !el.bgVideo.error && el.bgVideo.duration > 0;

  if (videoReady) {
    el.bgVideo.play();
    el.bgVideo.onended = () => {
      el.bgVideo.style.display = 'none';
      connectWebSocket();
    };
    setTimeout(() => { if (!ws) connectWebSocket(); }, 12000);
  } else {
    // No video asset yet — connect immediately
    connectWebSocket();
  }
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
        showScreen('game');
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
  updateAnimation();
}

function updateStatBars() {
  const f = kubeling.fullness;
  const m = kubeling.mood;
  // Fill is abs-positioned inside a bordered track; width relative to inner area
  el.fullnessBar.style.width = `calc(${f}% - ${(f / 100) * 8}px)`;
  el.fullnessBar.classList.toggle('low', f < 25);
  el.fullnessVal.textContent = Math.round(f);
  el.moodBar.style.width = `calc(${m}% - ${(m / 100) * 8}px)`;
  el.moodBar.classList.toggle('low', m < 25);
  el.moodVal.textContent = Math.round(m);
  el.viewport.classList.toggle('warning', f < 25 || m < 25);
  el.feedBtn.disabled = kubeling.sleeping || !kubeling.alive;
  el.gameName.textContent = kubeling.name;
}

function updateAnimation() {
  const s = kubeling;
  if (!s.alive)    { setAnim('dead');     return; }
  if (s.sleeping)  { setAnim('sleeping'); return; }
  if (s.fullness < 25 || s.mood < 25) { setAnim('crying'); return; }
  setAnim('idle');
}

function setAnim(state) {
  el.sprite.className = state;
  el.zzz.style.display = state === 'sleeping' ? 'block' : 'none';

  const src = SPRITES[state] ?? SPRITES.idle;
  if (el.spriteImg.dataset.state !== state) {
    el.spriteImg.src = src;
    el.spriteImg.dataset.state = state;
    // Show placeholder until real sprite loads
    el.spriteImg.style.display = 'none';
    el.spritePlaceholder.style.display = 'flex';
    el.spriteImg.onload = () => {
      el.spriteImg.style.display = 'block';
      el.spritePlaceholder.style.display = 'none';
    };
  }
}

// ── Actions ────────────────────────────────────────────────────────────────
el.feedBtn.addEventListener('click', () => {
  if (!ws || kubeling.sleeping || !kubeling.alive) return;
  ws.send(JSON.stringify({ action: 'feed' }));
  flashAnim('eating');
});

el.viewport.addEventListener('click', () => {
  if (!ws || kubeling.sleeping || !kubeling.alive) return;
  ws.send(JSON.stringify({ action: 'pet' }));
  flashAnim('confetti');
  spawnConffetiBurst();
});

function flashAnim(state) {
  clearTimeout(animTimeout);
  setAnim(state);
  animTimeout = setTimeout(updateAnimation, 1500);
}

function spawnConffetiBurst() {
  const burst = document.createElement('div');
  burst.className = 'confetti-burst';
  burst.textContent = '✨';
  el.viewport.appendChild(burst);
  burst.addEventListener('animationend', () => burst.remove());
}

// ── Death ──────────────────────────────────────────────────────────────────
function handleDeath(msg) {
  kubeling.alive = false;
  setAnim('dead');
  setTimeout(() => showDeathScreen(msg.cause_of_death, msg.lifespan_seconds, msg.peak_fullness, msg.peak_mood), 1500);
}

function showDeathScreen(cause, lifespan, peakFull, peakMood) {
  const causeMap = { hunger: 'DIED OF HUNGER', boredom: 'DIED OF BOREDOM', disconnected: 'POD TERMINATED' };
  el.deathName.textContent  = kubeling.name;
  el.deathCause.textContent = causeMap[cause] ?? 'UNKNOWN';
  el.deathLifespan.textContent  = lifespan  != null ? formatLifespan(lifespan) : '—';
  el.deathPeakFull.textContent  = peakFull  != null ? peakFull  : '—';
  el.deathPeakMood.textContent  = peakMood  != null ? peakMood  : '—';
  showScreen('death');
}

function formatLifespan(s) {
  const m = Math.floor(s / 60);
  return m === 0 ? `${s}s` : `${m}m ${s % 60}s`;
}

// ── Play again ─────────────────────────────────────────────────────────────
document.getElementById('btn-play-again').addEventListener('click', () => {
  if (ws) { ws.onclose = null; ws.close(); ws = null; }
  kubeling = { name: '', color: 'slate', fullness: 100, mood: 100, sleeping: false, alive: true };
  el.nameInput.value = '';
  if (el.bgVideo) { el.bgVideo.currentTime = 0; el.bgVideo.style.display = 'block'; }
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
