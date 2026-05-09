const API = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
  ? 'http://localhost:8000'
  : '';

// ── State ───────────────────────────────────────────────────
let currentMode   = 'glasses';
let glassesActive = false;
let glassesTimer  = null;
let isPending     = false;        // true while a request is in-flight
let lastSentAt    = 0;            // debounce: timestamp of last sent request
const DEBOUNCE_MS = 3000;         // minimum ms between requests
let audioCtx      = null;         // unlocked in user gesture
let currentSource = null;         // AudioBufferSourceNode
let gpsCoords     = null;
let stream        = null;

// ── Voice state ──────────────────────────────────────────────
let voiceBadgeTimer = null;
let isSpeaking      = false;  // browser TTS speaking

// ── Elements ─────────────────────────────────────────────────
const video           = document.getElementById('video');
const canvas          = document.getElementById('canvas');
const responseText    = document.getElementById('responseText');
const statusDot       = document.getElementById('statusDot');
const waveIndicator   = document.getElementById('waveIndicator');
const glassesBtn      = document.getElementById('glassesBtn');
const modeLabel       = document.getElementById('modeLabel');
const personBadge     = document.getElementById('personBadge');
const personBadgeName = document.getElementById('personBadgeName');
const scanLine        = document.getElementById('scanLine');
const micDot          = document.getElementById('micDot');
const voiceBadge      = document.getElementById('voiceBadge');
const voiceBadgeText  = document.getElementById('voiceBadgeText');
// voiceOverlay and micBtn are grabbed inside the voice module below

// ── Camera ──────────────────────────────────────────────────
async function initCamera() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
    video.srcObject = stream;
    setStatus('live');
    showToast('Cámara lista — toca ⏺ para activar');
  } catch {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      video.srcObject = stream;
      setStatus('live');
    } catch {
      showToast('No se pudo acceder a la cámara');
    }
  }
}

// ── GPS ─────────────────────────────────────────────────────
function startGPS() {
  if (!navigator.geolocation) return;
  navigator.geolocation.watchPosition(
    p => { gpsCoords = { lat: p.coords.latitude, lng: p.coords.longitude }; },
    null,
    { enableHighAccuracy: true, maximumAge: 5000 },
  );
}

// ── Frame capture (optimized: 640px wide, 0.7 quality) ──────
function captureFrame(quality = 0.7) {
  if (!video.videoWidth) return null;
  const w = 640;
  const h = Math.round(640 * (video.videoHeight / video.videoWidth));
  canvas.width  = w;
  canvas.height = h;
  canvas.getContext('2d').drawImage(video, 0, 0, w, h);
  return new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
}

// ── Core: send frame to Gemini ───────────────────────────────
async function captureAndDescribe() {
  const now = Date.now();
  if (isPending || (now - lastSentAt) < DEBOUNCE_MS) return;
  lastSentAt = now;
  isPending = true;
  setStatus('thinking');
  scanLine.classList.add('active');

  try {
    const blob = await captureFrame();
    if (!blob) {
      showResponse('Cámara no lista — espera un momento o recarga', false);
      return;
    }

    const form = new FormData();
    form.append('image', blob, 'frame.jpg');
    form.append('mode', currentMode);
    form.append('tts', 'false');   // text-only for speed; browser TTS reads it
    if (gpsCoords) {
      form.append('lat', gpsCoords.lat);
      form.append('lng', gpsCoords.lng);
    }

    // 10-second timeout so mobile doesn't cancel the request
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);

    let res;
    try {
      res = await fetch(`${API}/analyze`, { method: 'POST', body: form, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      showResponse(`Error del servidor: ${res.status}`, false);
      return;
    }
    const data = await res.json();

    if (!data.text) { showResponse('Respuesta vacía', false); return; }
    if (data.rate_limited) {
      showResponse('⚠ Cuota agotada — activa billing en aistudio.google.com', false);
      return;
    }

    const isDanger = /CUIDADO|peligro/i.test(data.text);
    showResponse(data.text, isDanger);
    setStatus(isDanger ? 'danger' : 'live');

    if (data.known_people?.length) showPersonBadge(data.known_people);

    // Browser TTS — instant, no network needed, won't timeout
    speakFallback(data.text);
  } catch (err) {
    console.error('[Clarity]', err);
    showResponse(`Sin conexión al servidor (${err.message})`, false);
    setStatus('live');
  } finally {
    isPending = false;
    scanLine.classList.remove('active');
  }
}

// Browser TTS — fast, offline, no timeout issues
function speakFallback(text) {
  if (!window.speechSynthesis) return;
  speechSynthesis.cancel();
  const utt  = new SpeechSynthesisUtterance(text);
  utt.lang   = 'es-MX';
  utt.rate   = 1.1;
  utt.pitch  = 1;
  const voices = speechSynthesis.getVoices();
  const es = voices.find(v => v.lang.startsWith('es'));
  if (es) utt.voice = es;
  utt.onstart = () => { setWave(true);  isSpeaking = true;  };
  utt.onend   = () => { setWave(false); isSpeaking = false; };
  utt.onerror = () => { setWave(false); isSpeaking = false; };
  speechSynthesis.speak(utt);
}

// ── Audio unlock (must be called inside a user gesture) ─────
function unlockAudio() {
  if (audioCtx) return;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  // Play a silent 1-sample buffer to fully unlock the context on iOS
  const buf = audioCtx.createBuffer(1, 1, 22050);
  const src = audioCtx.createBufferSource();
  src.buffer = buf;
  src.connect(audioCtx.destination);
  src.start(0);
}

// ── Glasses loop ─────────────────────────────────────────────
const LOOP_MS = 1000; // loop checks every 1s, debounce garantiza mínimo 3s entre requests

function startGlasses() {
  unlockAudio(); // must happen in the same call stack as the tap
  glassesActive = true;
  glassesBtn.classList.add('recording');
  showToast('Lentes activos — toca 🎤 para comandos');
  setTimeout(() => { if (glassesActive) captureAndDescribe(); }, 800);
  glassesTimer = setInterval(() => {
    // Wait for speech to finish before next capture so description isn't cut off
    if (!isPending && !currentSource && !isSpeaking) captureAndDescribe();
  }, LOOP_MS);
}

function stopGlasses() {
  glassesActive = false;
  clearInterval(glassesTimer);
  glassesTimer = null;
  glassesBtn.classList.remove('recording');
  setStatus('live');
  stopAudio();
  showToast('Lentes pausados');
}

function toggleGlasses() {
  if (glassesActive) stopGlasses();
  else startGlasses();
}

// ── Audio (Gemini voice via AudioContext) ────────────────────
async function playAudio(b64) {
  if (!audioCtx) return; // context not unlocked yet
  stopAudio();

  try {
    const bytes  = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    // decodeAudioData needs a copy (detaches the buffer)
    const buffer = await audioCtx.decodeAudioData(bytes.buffer.slice(0));
    const source = audioCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(audioCtx.destination);
    currentSource = source;
    setWave(true);
    source.start(0);
    source.onended = () => {
      setWave(false);
      if (currentSource === source) currentSource = null;
    };
  } catch (err) {
    console.error('[Audio]', err);
    setWave(false);
  }
}

function stopAudio() {
  if (currentSource) {
    try { currentSource.stop(); } catch { /* already stopped */ }
    currentSource = null;
  }
  setWave(false);
}

// ── UI helpers ───────────────────────────────────────────────
const MODE_LABELS = { glasses: 'ENTORNO', read: 'LEER TEXTO', people: 'PERSONAS' };

function setMode(mode, btn) {
  currentMode = mode;
  document.querySelectorAll('.mode-pill').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  modeLabel.textContent = MODE_LABELS[mode] ?? mode.toUpperCase();
}

function showResponse(text, isDanger = false) {
  responseText.textContent = text;
  responseText.className = 'hud-text visible' + (isDanger ? ' danger' : '');
}

let badgeTimer = null;
function showPersonBadge(people) {
  personBadgeName.textContent = people.join(', ');
  personBadge.classList.add('show');
  clearTimeout(badgeTimer);
  badgeTimer = setTimeout(() => personBadge.classList.remove('show'), 4500);
}

function setStatus(state) {
  statusDot.className = `hud-status-dot ${state}`;
}

function setWave(active) {
  waveIndicator.classList.toggle('speaking', active);
}

let toastTimer = null;
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2800);
}

// ── Social panel ─────────────────────────────────────────────
async function openSocialPanel() {
  document.getElementById('socialPanel').classList.add('open');
  await loadSocialData();
}

function closeSocialPanel() {
  document.getElementById('socialPanel').classList.remove('open');
}

function panelBackdropClick(e, id) {
  if (e.target === document.getElementById(id)) {
    document.getElementById(id).classList.remove('open');
  }
}

function showTab(tabId, btn) {
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById(tabId).classList.add('active');
  btn.classList.add('active');
}

async function loadSocialData() {
  try {
    const [sumRes, histRes] = await Promise.all([
      fetch(`${API}/interactions/summary`),
      fetch(`${API}/interactions`),
    ]);

    const { people }       = await sumRes.json();
    const { interactions } = await histRes.json();

    // People tab
    const pList = document.getElementById('socialPeopleList');
    if (!people.length) {
      pList.innerHTML = '<p class="empty-msg">Nadie reconocido aún.<br>Guarda personas con 💾 para empezar.</p>';
    } else {
      pList.innerHTML = people.map(p => `
        <div class="social-person-card">
          <div class="social-avatar">👤</div>
          <div>
            <div class="social-person-name">${escHtml(p.name)}</div>
            <div class="social-person-meta">
              ${p.count} ${p.count === 1 ? 'vez vista' : 'veces vista'} · ${relativeTime(p.last_seen)}
            </div>
            ${p.last_context ? `<div class="social-person-ctx">${escHtml(p.last_context)}</div>` : ''}
          </div>
        </div>
      `).join('');
    }

    // History tab
    const hList = document.getElementById('socialHistoryList');
    if (!interactions.length) {
      hList.innerHTML = '<p class="empty-msg">Sin interacciones recientes</p>';
    } else {
      hList.innerHTML = interactions.map(i => `
        <div class="history-item">
          <div class="history-person">👤 ${escHtml(i.person)}</div>
          <div class="history-ts">${relativeTime(i.ts)}</div>
          <div class="history-ctx">${escHtml(i.context)}</div>
        </div>
      `).join('');
    }
  } catch (err) {
    console.error('[Social]', err);
  }
}

function relativeTime(ts) {
  if (!ts) return '';
  const diff = Date.now() - new Date(ts).getTime();
  const min  = Math.floor(diff / 60000);
  if (min < 1)  return 'hace un momento';
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24)   return `hace ${h}h`;
  const d = Math.floor(h / 24);
  return `hace ${d} ${d === 1 ? 'día' : 'días'}`;
}

function escHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── Memory modal ─────────────────────────────────────────────
async function openMemoryModal() {
  document.getElementById('memoryModal').classList.add('open');
  await refreshPeopleList();
}

function closeMemoryModal() {
  document.getElementById('memoryModal').classList.remove('open');
}

function modalBackdropClick(e) {
  if (e.target === document.getElementById('memoryModal')) closeMemoryModal();
}

async function rememberPerson() {
  const name = document.getElementById('personNameInput').value.trim();
  if (!name) { showToast('Escribe un nombre'); return; }

  const blob = await captureFrame(0.9);
  if (!blob) { showToast('Sin imagen de cámara'); return; }

  const form = new FormData();
  form.append('image', blob, 'face.jpg');
  form.append('name', name);

  try {
    const res  = await fetch(`${API}/remember-person`, { method: 'POST', body: form });
    const data = await res.json();
    if (data.success) {
      showToast(`✓ ${name} guardado`);
      document.getElementById('personNameInput').value = '';
      await refreshPeopleList();
    } else {
      showToast(data.error || 'No se detectó un rostro');
    }
  } catch {
    showToast('Error al guardar');
  }
}

async function refreshPeopleList() {
  try {
    const res    = await fetch(`${API}/people`);
    const { people } = await res.json();
    const list   = document.getElementById('peopleList');
    if (!people.length) {
      list.innerHTML = '<p class="empty-msg">Sin personas guardadas</p>';
      return;
    }
    list.innerHTML = people.map(name => `
      <div class="person-item">
        <span>${escHtml(name)}</span>
        <button class="person-delete" onclick="deletePerson('${escHtml(name)}')">✕</button>
      </div>
    `).join('');
  } catch { /* ignore */ }
}

async function deletePerson(name) {
  try {
    await fetch(`${API}/people/${encodeURIComponent(name)}`, { method: 'DELETE' });
    showToast(`${name} eliminado`);
    await refreshPeopleList();
  } catch {
    showToast('Error al eliminar');
  }
}

// ── Voice commands ───────────────────────────────────────────
const voiceOverlay = document.getElementById('voiceOverlay');
const micBtn       = document.getElementById('micBtn');
let voiceListening = false;

function activateVoiceCommand() {
  if (voiceListening) return;

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { showToast('Tu navegador no soporta voz'); return; }

  // Pause auto-loop and audio while listening
  stopAudio();
  const wasActive = glassesActive;
  if (wasActive) clearInterval(glassesTimer);

  // Show overlay
  voiceListening = true;
  voiceOverlay.classList.add('active');
  micBtn.classList.add('active');

  const rec = new SR();
  rec.lang = 'es-MX';
  rec.continuous = false;
  rec.interimResults = false;
  rec.maxAlternatives = 5;

  let handled = false;

  rec.onresult = (e) => {
    const transcripts = Array.from(e.results[0])
      .map(r => r.transcript.toLowerCase().trim());
    console.log('[Voice] Escuché:', transcripts);
    handled = true;
    closeVoiceOverlay();
    processVoiceCommand(transcripts, wasActive);
  };

  rec.onerror = (e) => {
    console.warn('[Voice] Error:', e.error);
    if (e.error === 'not-allowed') showToast('Permiso de micrófono denegado');
    else if (!handled) showVoiceBadge('No escuché nada — intenta de nuevo');
    handled = true;
    closeVoiceOverlay(wasActive);
  };

  rec.onend = () => {
    if (!handled) {
      showVoiceBadge('No escuché nada — intenta de nuevo');
    }
    closeVoiceOverlay(wasActive);
  };

  try {
    rec.start();
  } catch (err) {
    showToast('No se pudo activar el micrófono');
    closeVoiceOverlay(wasActive);
  }
}

function closeVoiceOverlay(resumeLoop = false) {
  voiceListening = false;
  voiceOverlay.classList.remove('active');
  micBtn.classList.remove('active');
  // Resume loop if it was active
  if (resumeLoop && glassesActive) {
    glassesTimer = setInterval(() => {
      if (!isPending) captureAndDescribe();
    }, LOOP_MS);
  }
}

function processVoiceCommand(transcripts, resumeLoop) {
  // Try each alternative until one matches
  for (const t of transcripts) {
    // ── Guardar persona ──────────────────────────────────────
    const saveMatch =
      t.match(/guarda(?:r)?\s+a\s+esta\s+persona\s+como\s+(.+)/) ||
      t.match(/guarda(?:r)?\s+como\s+(.+)/) ||
      t.match(/guarda\s+a\s+(.+)/);

    if (saveMatch) {
      const name = saveMatch[1]
        .replace(/^(a\s+)?(el|la|los|las)\s+/i, '')
        .replace(/[.,!?]+$/, '')
        .trim();
      if (name) {
        showVoiceBadge(`Guardando a ${name}…`);
        voiceSavePerson(name, resumeLoop);
        return;
      }
    }

    // ── Describe / Hey Clarity ───────────────────────────────
    if (/clarity|describe|qué hay|qué ves|analiza|entorno/i.test(t)) {
      showVoiceBadge('Analizando entorno…');
      if (!isPending) captureAndDescribe();
      return;
    }
  }

  // No command matched — show what was heard
  showVoiceBadge(`No entendí: "${transcripts[0]}"`);
}

function showVoiceBadge(text) {
  voiceBadgeText.textContent = text;
  voiceBadge.classList.add('show');
  clearTimeout(voiceBadgeTimer);
  voiceBadgeTimer = setTimeout(() => voiceBadge.classList.remove('show'), 3500);
}

async function voiceSavePerson(name, resumeLoop) {
  const blob = await captureFrame(0.92);
  if (!blob) {
    showVoiceBadge('Sin imagen de cámara');
    speakFallback('No pude capturar una imagen');
    return;
  }

  const form = new FormData();
  form.append('image', blob, 'face.jpg');
  form.append('name', name);

  try {
    const res  = await fetch(`${API}/remember-person`, { method: 'POST', body: form });
    const data = await res.json();
    if (data.success) {
      showVoiceBadge(`✓ ${name} guardado`);
      speakFallback(`Listo, guardé a ${name}`);
    } else {
      showVoiceBadge(data.error || 'No detecté un rostro claro');
      speakFallback(`No pude guardar a ${name}. ${data.error || 'Inténtalo de nuevo'}`);
    }
  } catch {
    showVoiceBadge('Error al conectar con el servidor');
  }
}

// ── Boot ─────────────────────────────────────────────────────
window.addEventListener('load', () => {
  initCamera();
  startGPS();
});
