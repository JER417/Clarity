const API = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? 'http://localhost:8000'
  : '';  // Same origin in production

// ── State ──────────────────────────────────────────────────
let currentMode = 'full';
let autoInterval = null;
let isAnalyzing = false;
let gpsCoords = null;
let stream = null;

const video = document.getElementById('video');
const canvas = document.getElementById('canvas');
const responseText = document.getElementById('responseText');
const statusDot = document.getElementById('statusDot');
const waveIndicator = document.getElementById('waveIndicator');
const analyzeBtn = document.getElementById('analyzeBtn');
const analyzeBtnIcon = document.getElementById('analyzeBtnIcon');
const autoBadge = document.getElementById('autoBadge');
const autoBtn = document.getElementById('autoBtn');

// ── Camera init ─────────────────────────────────────────────
async function initCamera() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
    video.srcObject = stream;
    setStatus('live');
    showToast('Cámara lista');
  } catch (err) {
    try {
      // Fallback to front camera
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
    (pos) => { gpsCoords = { lat: pos.coords.latitude, lng: pos.coords.longitude }; },
    null,
    { enableHighAccuracy: true, maximumAge: 5000 }
  );
}

// ── Capture frame ───────────────────────────────────────────
function captureFrame(quality = 0.85) {
  if (!video.videoWidth) return null;
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
}

// ── Main analyze ────────────────────────────────────────────
async function captureAndAnalyze() {
  if (isAnalyzing) return;
  isAnalyzing = true;

  setStatus('thinking');
  setAnalyzeLoading(true);
  document.getElementById('cameraContainer').classList.add('scanning');

  try {
    const blob = await captureFrame();
    if (!blob) throw new Error('No hay imagen de cámara');

    const form = new FormData();
    form.append('image', blob, 'frame.jpg');
    form.append('mode', currentMode);
    form.append('tts', 'true');
    if (gpsCoords) {
      form.append('lat', gpsCoords.lat);
      form.append('lng', gpsCoords.lng);
    }

    const res = await fetch(`${API}/analyze`, { method: 'POST', body: form });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    showResponse(data.text, data.text.includes('CUIDADO') || data.text.includes('peligro'));
    setStatus('live');

    if (data.audio_b64) {
      await playAudioB64(data.audio_b64);
    } else {
      speakText(data.text);
    }
  } catch (err) {
    console.error(err);
    showResponse('Error al analizar la imagen. Intenta de nuevo.', false);
    speakText('Error al analizar. Intenta de nuevo.');
    setStatus('live');
  } finally {
    isAnalyzing = false;
    setAnalyzeLoading(false);
    document.getElementById('cameraContainer').classList.remove('scanning');
  }
}

// ── Audio playback ───────────────────────────────────────────
async function playAudioB64(b64) {
  try {
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const audioBuffer = await audioCtx.decodeAudioData(bytes.buffer);
    const source = audioCtx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(audioCtx.destination);
    setWave(true);
    source.start(0);
    source.onended = () => setWave(false);
  } catch {
    // Fallback to browser TTS if audio decoding fails
    speakText(responseText.textContent);
  }
}

function speakText(text) {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const utt = new SpeechSynthesisUtterance(text);
  utt.lang = 'es-MX';
  utt.rate = 1.05;
  utt.pitch = 1;

  // Prefer a Spanish voice if available
  const voices = speechSynthesis.getVoices();
  const spanish = voices.find(v => v.lang.startsWith('es'));
  if (spanish) utt.voice = spanish;

  utt.onstart = () => setWave(true);
  utt.onend = () => setWave(false);
  speechSynthesis.speak(utt);
}

// ── UI helpers ───────────────────────────────────────────────
function setMode(mode, btn) {
  currentMode = mode;
  document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}

function toggleAuto() {
  if (autoInterval) {
    clearInterval(autoInterval);
    autoInterval = null;
    autoBadge.classList.remove('visible');
    autoBtn.classList.remove('active-toggle');
    showToast('Modo automático desactivado');
  } else {
    autoInterval = setInterval(() => { if (!isAnalyzing) captureAndAnalyze(); }, 4000);
    autoBadge.classList.add('visible');
    autoBtn.classList.add('active-toggle');
    showToast('Modo automático activado (4s)');
    captureAndAnalyze();
  }
}

function setStatus(state) {
  statusDot.className = `status-dot ${state}`;
}

function setAnalyzeLoading(loading) {
  analyzeBtn.classList.toggle('loading', loading);
  analyzeBtnIcon.textContent = loading ? '' : '👁';
}

function setWave(active) {
  waveIndicator.classList.toggle('speaking', active);
}

function showResponse(text, isDanger = false) {
  responseText.textContent = text;
  responseText.className = 'response-text visible' + (isDanger ? ' danger-text' : '');
  if (isDanger) setStatus('danger');
}

let toastTimer = null;
function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2500);
}

// ── Memory modal ─────────────────────────────────────────────
async function openMemoryModal() {
  document.getElementById('memoryModal').classList.add('open');
  await refreshPeopleList();
}

function closeModal() {
  document.getElementById('memoryModal').classList.remove('open');
}

document.getElementById('memoryModal').addEventListener('click', (e) => {
  if (e.target === document.getElementById('memoryModal')) closeModal();
});

async function rememberPerson() {
  const name = document.getElementById('personNameInput').value.trim();
  if (!name) { showToast('Escribe un nombre'); return; }

  const blob = await captureFrame(0.9);
  if (!blob) { showToast('No hay imagen de cámara'); return; }

  const form = new FormData();
  form.append('image', blob, 'face.jpg');
  form.append('name', name);

  try {
    const res = await fetch(`${API}/remember-person`, { method: 'POST', body: form });
    const data = await res.json();
    if (data.success) {
      showToast(`✓ ${name} guardado`);
      document.getElementById('personNameInput').value = '';
      await refreshPeopleList();
    } else {
      showToast(data.error || 'No se detectó un rostro');
    }
  } catch {
    showToast('Error al guardar persona');
  }
}

async function rememberPlace() {
  const desc = document.getElementById('placeDescInput').value.trim();
  if (!desc) { showToast('Escribe una descripción'); return; }
  if (!gpsCoords) { showToast('GPS no disponible'); return; }

  const form = new FormData();
  form.append('description', desc);
  form.append('lat', gpsCoords.lat);
  form.append('lng', gpsCoords.lng);

  try {
    await fetch(`${API}/remember-place`, { method: 'POST', body: form });
    showToast(`✓ "${desc}" guardado`);
    document.getElementById('placeDescInput').value = '';
  } catch {
    showToast('Error al guardar lugar');
  }
}

async function refreshPeopleList() {
  try {
    const res = await fetch(`${API}/people`);
    const data = await res.json();
    const list = document.getElementById('peopleList');

    if (!data.people.length) {
      list.innerHTML = '<p style="color:var(--text-muted);font-size:13px;margin-top:8px">No hay personas guardadas</p>';
      return;
    }

    list.innerHTML = '<p style="color:var(--text-muted);font-size:12px;margin-bottom:8px">Personas guardadas:</p>' +
      data.people.map(name => `
        <div class="person-item">
          <span>${name}</span>
          <button class="person-delete" onclick="deletePerson('${name}')">✕</button>
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

// ── Boot ─────────────────────────────────────────────────────
window.addEventListener('load', () => {
  initCamera();
  startGPS();
  speechSynthesis.getVoices(); // pre-load voices
});
