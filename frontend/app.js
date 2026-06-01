const WS_URL = `ws://${window.location.host}/ws`;

const SPRITES = {
  idle:     'sprites/idle.gif',
  eating:   'sprites/eat.gif',
  sleeping: 'sprites/sleep.gif',
  confetti: 'sprites/confetti.gif',
  crying:   'sprites/cry.gif',
};

// ── State ──────────────────────────────────────────────────────────────────
let ws = null;
let kubeling = { name: '', color: '#a8ff3e', fullness: 100, mood: 100, sleeping: false, alive: true };
let animTimeout = null;

// ── DOM refs ───────────────────────────────────────────────────────────────
const screens = {
  onboarding: document.getElementById('screen-onboarding'),
  spawn:      document.getElementById('screen-spawn'),
  game:       document.getElementById('screen-game'),
  death:      document.getElementById('screen-death'),
};

const el = {
  nameInput:       document.getElementById('input-name'),
  colorInput:      document.getElementById('input-color'),
  colorPreview:    document.getElementById('color-preview'),
  spawnBtn:        document.getElementById('btn-spawn'),
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

// ── Screen transitions ─────────────────────────────────────────────────────
function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.remove('active'));
  screens[name].classList.add('active');
}

// ── Color picker live preview ──────────────────────────────────────────────
el.colorInput.addEventListener('input', () => {
  el.colorPreview.style.background = el.colorInput.value;
  kubeling.color = el.colorInput.value;
  applyColor(el.colorInput.value);
});

function applyColor(hex) {
  el.spritePlaceholder.style.background = hex;
  el.spriteImg.style.filter = `drop-shadow(0 0 6px ${hex})`;
}

// ── Onboarding submit ──────────────────────────────────────────────────────
document.getElementById('form-onboard').addEventListener('submit', e => {
  e.preventDefault();
  const name = el.nameInput.value.trim();
  if (!name) return;
  kubeling.name = name;
  kubeling.color = el.colorInput.value;
  runSpawnAnimation();
});

function runSpawnAnimation() {
  showScreen('spawn');
  // After animation completes, open WS and go to game
  setTimeout(() => {
    connectWebSocket();
  }, 2200);
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
      case 'state':
        applyState(msg);
        if (msg.type === 'spawned') showScreen('game');
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
      // Unexpected disconnect
      kubeling.alive = false;
      showDeathScreen('disconnected', null, null, null);
    }
  };
}

// ── Apply server state ─────────────────────────────────────────────────────
function applyState(msg) {
  kubeling = { ...kubeling, ...msg };
  updateStatBars();
  updateAnimation();
}

function updateStatBars() {
  const f = kubeling.fullness;
  const m = kubeling.mood;

  el.fullnessBar.style.width = `${f}%`;
  el.fullnessBar.classList.toggle('low', f < 25);
  el.fullnessVal.textContent = Math.round(f);

  el.moodBar.style.width = `${m}%`;
  el.moodBar.classList.toggle('low', m < 25);
  el.moodVal.textContent = Math.round(m);

  el.viewport.classList.toggle('warning', f < 25 || m < 25);

  el.feedBtn.disabled = kubeling.sleeping || !kubeling.alive;
}

function updateAnimation() {
  const s = kubeling;
  if (!s.alive) { setAnim('dead'); return; }
  if (s.sleeping) { setAnim('sleeping'); return; }
  if (s.fullness < 25 || s.mood < 25) { setAnim('crying'); return; }
  setAnim('idle');
}

// ── Sprite animation swap ──────────────────────────────────────────────────
function setAnim(state) {
  el.sprite.className = state;
  el.zzz.style.display = state === 'sleeping' ? 'block' : 'none';
  el.gameName.textContent = kubeling.name;

  const src = SPRITES[state] ?? SPRITES.idle;
  if (el.spriteImg.dataset.state !== state) {
    el.spriteImg.src = src;
    el.spriteImg.dataset.state = state;
    // Fallback: if no sprite file, keep placeholder visible
    el.spriteImg.style.display = 'none';
    el.spritePlaceholder.style.display = 'flex';
  }
  applyColor(kubeling.color);
}

// ── Feed ───────────────────────────────────────────────────────────────────
el.feedBtn.addEventListener('click', () => {
  if (!ws || kubeling.sleeping || !kubeling.alive) return;
  ws.send(JSON.stringify({ action: 'feed' }));
  flashAnim('eating');
});

// ── Pet (click on Kubeling) ────────────────────────────────────────────────
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
  burst.textContent = '🎉';
  el.viewport.appendChild(burst);
  burst.addEventListener('animationend', () => burst.remove());
}

// ── Death ──────────────────────────────────────────────────────────────────
function handleDeath(msg) {
  kubeling.alive = false;
  setAnim('dead');
  setTimeout(() => {
    showDeathScreen(msg.cause_of_death, msg.lifespan_seconds, msg.peak_fullness, msg.peak_mood);
  }, 1500);
}

function showDeathScreen(cause, lifespan, peakFull, peakMood) {
  const causeText = { hunger: 'DIED OF HUNGER', boredom: 'DIED OF BOREDOM', disconnected: 'POD TERMINATED' };
  el.deathName.textContent = kubeling.name;
  el.deathCause.textContent = causeText[cause] ?? 'UNKNOWN';
  el.deathLifespan.textContent = lifespan != null ? formatLifespan(lifespan) : '—';
  el.deathPeakFull.textContent = peakFull != null ? peakFull : '—';
  el.deathPeakMood.textContent = peakMood != null ? peakMood : '—';
  showScreen('death');
}

function formatLifespan(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${s}s`;
}

// ── Play again ─────────────────────────────────────────────────────────────
document.getElementById('btn-play-again').addEventListener('click', () => {
  if (ws) { ws.onclose = null; ws.close(); ws = null; }
  kubeling = { name: '', color: '#a8ff3e', fullness: 100, mood: 100, sleeping: false, alive: true };
  el.nameInput.value = '';
  el.colorInput.value = '#a8ff3e';
  el.colorPreview.style.background = '#a8ff3e';
  showScreen('onboarding');
});

// ── Init ───────────────────────────────────────────────────────────────────
showScreen('onboarding');
el.colorPreview.style.background = el.colorInput.value;
