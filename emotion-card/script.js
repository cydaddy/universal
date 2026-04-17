/* ===========================
   감정카드 — script.js
   =========================== */

// ────────────────────────────────────────────────
// 감정 데이터 (50개)
// ────────────────────────────────────────────────
const EMOTIONS = [
  // 긍정 감정
  { word: '감동적이다',   emoji: '🥺' },
  { word: '감사하다',     emoji: '🙏' },
  { word: '기대되다',     emoji: '🌟' },
  { word: '기쁘다',       emoji: '😊' },
  { word: '놀랍다',       emoji: '🤩' },
  { word: '든든하다',     emoji: '💪' },
  { word: '만족스럽다',   emoji: '😌' },
  { word: '사랑스럽다',   emoji: '💕' },
  { word: '신나다',       emoji: '🎉' },
  { word: '열중하다',     emoji: '🔥' },
  { word: '자랑스럽다',   emoji: '🏆' },
  { word: '자신있다',     emoji: '😎' },
  { word: '재미있다',     emoji: '😄' },
  { word: '편안하다',     emoji: '🌿' },
  { word: '평화롭다',     emoji: '☮️' },
  { word: '홀가분하다',   emoji: '🕊️' },
  { word: '활기차다',     emoji: '⚡' },
  { word: '황홀하다',     emoji: '✨' },

  // 불안·두려움
  { word: '걱정스럽다',   emoji: '😰' },
  { word: '긴장하다',     emoji: '😬' },
  { word: '깜짝 놀라다',  emoji: '😱' },
  { word: '당황하다',     emoji: '😳' },
  { word: '두렵다',       emoji: '😨' },
  { word: '무섭다',       emoji: '👻' },
  { word: '불안하다',     emoji: '🌪️' },
  { word: '혼란스럽다',   emoji: '🌀' },

  // 부정·분노
  { word: '답답하다',     emoji: '😤' },
  { word: '밉다',         emoji: '😠' },
  { word: '분하다',       emoji: '😡' },
  { word: '억울하다',     emoji: '😢' },
  { word: '짜증나다',     emoji: '🙄' },

  // 무기력·권태
  { word: '귀찮다',       emoji: '😑' },
  { word: '무관심하다',   emoji: '😶' },
  { word: '부끄럽다',     emoji: '🫣' },
  { word: '부럽다',       emoji: '🫤' },
  { word: '싸늘하다',     emoji: '🥶' },
  { word: '지루하다',     emoji: '😴' },
  { word: '피곤하다',     emoji: '😩' },

  // 슬픔·상실
  { word: '괴롭다',       emoji: '😖' },
  { word: '그립다',       emoji: '💭' },
  { word: '막막하다',     emoji: '🌫️' },
  { word: '미안하다',     emoji: '🙇' },
  { word: '서운하다',     emoji: '💔' },
  { word: '슬프다',       emoji: '😢' },
  { word: '실망스럽다',   emoji: '😞' },
  { word: '안타깝다',     emoji: '😕' },
  { word: '외롭다',       emoji: '🌙' },
  { word: '우울하다',     emoji: '🌧️' },
  { word: '좌절하다',     emoji: '😫' },
  { word: '후회스럽다',   emoji: '😔' },
];

// ────────────────────────────────────────────────
// DOM 참조
// ────────────────────────────────────────────────
const card         = document.getElementById('card');
const emojiEl      = document.getElementById('emotion-emoji');
const wordEl       = document.getElementById('emotion-word');
const retryBtn     = document.getElementById('retry-btn');
const sparkleBox   = document.getElementById('sparkle-container');
const frontInner   = document.getElementById('card-front-inner');
const canvas       = document.getElementById('bg-canvas');
const ctx          = canvas.getContext('2d');
const particleLayer = document.getElementById('particle-layer');

let isFlipped = false;

// ────────────────────────────────────────────────
// Web Audio 엔진 (외부 파일 없이 합성)
// ────────────────────────────────────────────────
let audioCtx = null;

function getAudioCtx() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  // 브라우저 정사진 정송 대응
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

/**
 * 카드 뒤집기 사운드
 * 1단계: 마로 흥황소리 (화이트 노이즈 + bandpass)
 * 2단계: 상승 스파클 체임 톤 3개
 */
function playSoundFlip() {
  const ac = getAudioCtx();
  const now = ac.currentTime;

  // ── 1. Whoosh (filtered noise) ──
  const bufLen = ac.sampleRate * 0.35;
  const buf = ac.createBuffer(1, bufLen, ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < bufLen; i++) data[i] = Math.random() * 2 - 1;

  const noise = ac.createBufferSource();
  noise.buffer = buf;

  const bpf = ac.createBiquadFilter();
  bpf.type = 'bandpass';
  bpf.frequency.setValueAtTime(600, now);
  bpf.frequency.linearRampToValueAtTime(2400, now + 0.25);
  bpf.Q.value = 0.8;

  const noiseGain = ac.createGain();
  noiseGain.gain.setValueAtTime(0, now);
  noiseGain.gain.linearRampToValueAtTime(0.18, now + 0.04);
  noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);

  noise.connect(bpf);
  bpf.connect(noiseGain);
  noiseGain.connect(ac.destination);
  noise.start(now);
  noise.stop(now + 0.36);

  // ── 2. Sparkle chimes (3개 상승) ──
  const chimeFreqs = [880, 1108, 1480];
  chimeFreqs.forEach((freq, i) => {
    const osc  = ac.createOscillator();
    const gain = ac.createGain();
    const t    = now + 0.18 + i * 0.07;

    osc.type = 'sine';
    osc.frequency.value = freq;

    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.12, t + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.38);

    osc.connect(gain);
    gain.connect(ac.destination);
    osc.start(t);
    osc.stop(t + 0.4);
  });
}

/**
 * 되돌리기 사운드
 * 부드럽게 내려가는 두 개의 싸인음
 */
function playSoundReset() {
  const ac  = getAudioCtx();
  const now = ac.currentTime;
  const resetFreqs = [660, 440];

  resetFreqs.forEach((freq, i) => {
    const osc  = ac.createOscillator();
    const gain = ac.createGain();
    const t    = now + i * 0.08;

    osc.type = 'sine';
    osc.frequency.value = freq;

    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.09, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);

    osc.connect(gain);
    gain.connect(ac.destination);
    osc.start(t);
    osc.stop(t + 0.32);
  });
}

// ────────────────────────────────────────────────
// 랜덤 감정 뽑기
// ────────────────────────────────────────────────
function pickEmotion() {
  return EMOTIONS[Math.floor(Math.random() * EMOTIONS.length)];
}

// ────────────────────────────────────────────────
// 카드 앞면 콘텐츠 교체 (애니메이션 재트리거)
// ────────────────────────────────────────────────
function setEmotion(emotion) {
  // 클래스 제거 → reflow → 재적용으로 애니메이션 재시작
  emojiEl.classList.remove('anim-pop');
  wordEl.classList.remove('anim-fade');
  retryBtn.classList.remove('anim-retry');

  emojiEl.textContent = emotion.emoji;
  wordEl.textContent  = emotion.word;

  void emojiEl.offsetWidth; // reflow 강제

  emojiEl.classList.add('anim-pop');
  wordEl.classList.add('anim-fade');
  retryBtn.classList.add('anim-retry');
}

// ────────────────────────────────────────────────
// 카드 뒤집기
// ────────────────────────────────────────────────
function flipCard() {
  if (isFlipped) return;

  isFlipped = true;
  playSoundFlip();
  const emotion = pickEmotion();
  setEmotion(emotion);

  card.classList.add('is-flipped');
  burstParticles();
}

// ────────────────────────────────────────────────
// 카드 되돌리기 (다시 뽑기)
// ────────────────────────────────────────────────
function resetCard(e) {
  e.stopPropagation();
  playSoundReset();
  card.classList.remove('is-flipped');

  setTimeout(() => {
    isFlipped = false;
  }, 750);
}

// ────────────────────────────────────────────────
// 이벤트
// ────────────────────────────────────────────────
card.addEventListener('click', flipCard);
card.addEventListener('keydown', (e) => {
  if ((e.key === 'Enter' || e.key === ' ') && !isFlipped) {
    e.preventDefault();
    flipCard();
  }
});
retryBtn.addEventListener('click', resetCard);

// ────────────────────────────────────────────────
// 반짝이 생성 (카드 뒷면)
// ────────────────────────────────────────────────
function createSparkles() {
  const COUNT = 22;
  for (let i = 0; i < COUNT; i++) {
    const s = document.createElement('div');
    s.className = 'sparkle';
    s.style.cssText = `
      left:  ${Math.random() * 100}%;
      top:   ${Math.random() * 100}%;
      --s-dur:   ${1.5 + Math.random() * 2}s;
      --s-delay: ${Math.random() * 3}s;
      width:  ${Math.random() * 4 + 2}px;
      height: ${Math.random() * 4 + 2}px;
      background: hsl(${250 + Math.random() * 80}, 100%, ${70 + Math.random() * 30}%);
    `;
    sparkleBox.appendChild(s);
  }
}
createSparkles();

// ────────────────────────────────────────────────
// 앞면 반짝이 생성
// ────────────────────────────────────────────────
function createFrontSparkles() {
  const frontBox = document.getElementById('front-sparkle-container');
  if (!frontBox) return;
  const COUNT = 16;
  for (let i = 0; i < COUNT; i++) {
    const s = document.createElement('div');
    s.className = 'sparkle';
    s.style.cssText = `
      left:  ${Math.random() * 100}%;
      top:   ${Math.random() * 100}%;
      --s-dur:   ${2 + Math.random() * 3}s;
      --s-delay: ${Math.random() * 4}s;
      width:  ${Math.random() * 3 + 1.5}px;
      height: ${Math.random() * 3 + 1.5}px;
      background: hsl(${270 + Math.random() * 60}, 90%, ${75 + Math.random() * 25}%);
    `;
    frontBox.appendChild(s);
  }
}
createFrontSparkles();


// ────────────────────────────────────────────────
// 뒤집힐 때 파티클 폭발
// ────────────────────────────────────────────────
function burstParticles() {
  const count = 18;
  for (let i = 0; i < count; i++) {
    const p = document.createElement('div');
    p.style.cssText = `
      position: absolute;
      width:  ${6 + Math.random() * 8}px;
      height: ${6 + Math.random() * 8}px;
      border-radius: 50%;
      left: 50%;
      top:  50%;
      background: hsl(${250 + Math.random() * 100}, 100%, ${65 + Math.random() * 25}%);
      pointer-events: none;
      z-index: 20;
    `;
    document.body.appendChild(p);

    const angle = (i / count) * Math.PI * 2;
    const dist  = 80 + Math.random() * 120;
    const dx = Math.cos(angle) * dist;
    const dy = Math.sin(angle) * dist;

    p.animate([
      { transform: 'translate(-50%, -50%) scale(1)', opacity: 1 },
      { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(0)`, opacity: 0 },
    ], {
      duration: 600 + Math.random() * 400,
      easing: 'cubic-bezier(0, 0.9, 0.57, 1)',
      fill: 'forwards',
    }).onfinish = () => p.remove();
  }
}

// ────────────────────────────────────────────────
// 浮遊 파티클 (배경 레이어)
// ────────────────────────────────────────────────
function createFloatingParticles() {
  const COUNT = 30;
  for (let i = 0; i < COUNT; i++) {
    const p = document.createElement('div');
    p.className = 'particle';
    const size = 3 + Math.random() * 8;
    const hue  = 240 + Math.random() * 120;
    const sat  = 60 + Math.random() * 40;
    const lit  = 55 + Math.random() * 35;
    const maxOp = (0.2 + Math.random() * 0.5).toFixed(2);
    p.style.cssText = `
      width:  ${size}px;
      height: ${size}px;
      left:   ${Math.random() * 100}%;
      top:    ${90 + Math.random() * 20}%;
      background: radial-gradient(circle, hsl(${hue},${sat}%,${lit}%), transparent 70%);
      --dur:         ${5 + Math.random() * 10}s;
      --delay:       ${Math.random() * -12}s;
      --max-opacity: ${maxOp};
    `;
    particleLayer.appendChild(p);
  }
}
createFloatingParticles();

// ────────────────────────────────────────────────
// 동적 추상 배경 (캔버스)
// ────────────────────────────────────────────────

const blobs = [];
const BLOB_COUNT = 8;

function initCanvas() {
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;

  blobs.length = 0;
  for (let i = 0; i < BLOB_COUNT; i++) {
    blobs.push({
      x:   Math.random() * canvas.width,
      y:   Math.random() * canvas.height,
      r:   150 + Math.random() * 250,
      vx:  (Math.random() - 0.5) * 0.5,
      vy:  (Math.random() - 0.5) * 0.5,
      hue: 220 + Math.random() * 120,
      sat: 60 + Math.random() * 40,
      lit: 20 + Math.random() * 20,
      alpha: 0.12 + Math.random() * 0.18,
      pulseSpeed: 0.003 + Math.random() * 0.005,
      pulsePhase: Math.random() * Math.PI * 2,
    });
  }
}

// 노이즈 근사 (단순 sin 합성)
function softNoise(x, y, t) {
  return (
    Math.sin(x * 0.003 + t * 0.4) * 0.4 +
    Math.sin(y * 0.004 + t * 0.3) * 0.3 +
    Math.sin((x + y) * 0.002 + t * 0.5) * 0.3
  );
}

let time = 0;

function drawBackground() {
  const w = canvas.width, h = canvas.height;

  // 베이스 그라디언트
  const base = ctx.createLinearGradient(0, 0, w, h);
  base.addColorStop(0,   '#050510');
  base.addColorStop(0.5, '#09090f');
  base.addColorStop(1,   '#060615');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);

  // Blob 그리기
  blobs.forEach((b) => {
    const pulse = Math.sin(time * b.pulseSpeed * 60 + b.pulsePhase);
    const r = b.r * (1 + pulse * 0.12);

    // 이동
    b.x += b.vx;
    b.y += b.vy;

    // 벽 반사
    if (b.x < -r)   { b.x = w + r; }
    if (b.x > w + r) { b.x = -r; }
    if (b.y < -r)   { b.y = h + r; }
    if (b.y > h + r) { b.y = -r; }

    // 색상 표류
    b.hue += 0.04;

    const grd = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, r);
    grd.addColorStop(0,   `hsla(${b.hue},${b.sat}%,${b.lit}%,${b.alpha})`);
    grd.addColorStop(0.6, `hsla(${b.hue + 30},${b.sat}%,${b.lit - 5}%,${b.alpha * 0.5})`);
    grd.addColorStop(1,   `hsla(${b.hue},${b.sat}%,${b.lit}%,0)`);

    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.arc(b.x, b.y, r, 0, Math.PI * 2);
    ctx.fill();
  });

  // 미묘한 노이즈 체인 (세로 라인 형태)
  ctx.save();
  ctx.globalAlpha = 0.025;
  for (let x = 0; x < w; x += 60) {
    for (let y = 0; y < h; y += 60) {
      const n = softNoise(x, y, time);
      const hue = 240 + n * 80;
      ctx.fillStyle = `hsl(${hue}, 70%, 50%)`;
      ctx.fillRect(x + n * 20, y + n * 20, 4, 4);
    }
  }
  ctx.restore();

  // 비네트
  const vig = ctx.createRadialGradient(w/2, h/2, h * 0.25, w/2, h/2, h * 0.85);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(0,0,0,0.65)');
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, w, h);

  time += 0.008;
}

function animate() {
  drawBackground();
  requestAnimationFrame(animate);
}

// 리사이즈 대응
window.addEventListener('resize', () => {
  initCanvas();
});

// 시작
initCanvas();
animate();
