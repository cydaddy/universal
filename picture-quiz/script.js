/* ==========================================================
   📷 그림 퀴즈 — Main Script
   ========================================================== */

// ── State ──────────────────────────────────────────────────
const state = {
    questions: [],       // { number, image (dataURL), answer }
    currentIndex: 0,
    timerDuration: 5,    // seconds
    timerRemaining: 0,
    timerInterval: null,
    audioCtx: null,
    isPaused: false,
};

// ── DOM refs ───────────────────────────────────────────────
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const setupScreen    = $('#setup-screen');
const quizScreen     = $('#quiz-screen');
const endScreen      = $('#end-screen');
const questionGrid   = $('#question-grid');
const startBtn       = $('#start-btn');
const timerInput     = $('#timer-input');
const bulkBtn        = $('#bulk-upload-btn');
const bulkFileInput  = $('#bulk-file-input');
const registeredCount = $('#registered-count');
const totalCount     = $('#total-count');
const questionNumber = $('#question-number');
const quizProgress   = $('#quiz-progress');
const quizImage      = $('#quiz-image');
const bombContainer  = $('#bomb-container');
const answerOverlay  = $('#answer-overlay');
const readyScreen    = $('#ready-screen');
const realStartBtn   = $('#real-start-btn');
const cancelStartBtn = $('#cancel-start-btn');


const newSetBtn      = $('#new-set-btn');
const pauseBtn       = $('#pause-btn');
const stopBtn        = $('#stop-btn');

// ── Initialise ─────────────────────────────────────────────
function init() {
    // Initial load map
    loadFromLocalStorage();

    startBtn.addEventListener('click', prepareQuiz);
    realStartBtn.addEventListener('click', startQuiz);
    cancelStartBtn.addEventListener('click', () => switchScreen(setupScreen));
    nextBtn.addEventListener('click', nextQuestion);
    restartBtn.addEventListener('click', restart);
    
    bulkBtn.addEventListener('click', () => bulkFileInput.click());
    bulkFileInput.addEventListener('change', handleBulkUpload);
    
    timerInput.addEventListener('input', () => {
        state.timerDuration = Math.max(1, parseInt(timerInput.value) || 5);
    });

    newSetBtn.addEventListener('click', clearAllData);

    pauseBtn.addEventListener('click', togglePause);
    stopBtn.addEventListener('click', restart);
}

function ensureEmptyCardAtEnd() {
    const cards = $$('.question-card');
    if (cards.length === 0) {
        addCard();
        return;
    }
    const lastCard = cards[cards.length - 1];
    const img = lastCard.dataset.imageData;
    const ans = lastCard.querySelector('.answer-input').value.trim();
    
    if (img || ans) {
        addCard();
    }
}

// ── Cards ──────────────────────────────────────────────────
let draggedCard = null;

function addCard() {
    const i = $$('.question-card').length;
    const card = document.createElement('div');
    card.className = 'question-card';
    card.dataset.index = i;
    card.draggable = true;
    card.innerHTML = `
        <div class="card-number">${i + 1}</div>
        <div class="card-controls">
            <button class="card-btn move-left" title="왼쪽으로 이동">◀</button>
            <button class="card-btn move-right" title="오른쪽으로 이동">▶</button>
            <button class="card-btn delete-btn" title="삭제">✕</button>
        </div>
        <div class="upload-area" data-index="${i}">
            <div class="upload-placeholder">
                <span class="upload-icon">📷</span>
                <span>이미지 업로드</span>
            </div>
        </div>
        <input type="text" class="answer-input" placeholder="정답 입력" data-index="${i}">
        <input type="file" class="file-input" accept="image/*" data-index="${i}" hidden>
    `;

    const uploadArea = card.querySelector('.upload-area');
    const fileInput  = card.querySelector('.file-input');
    const answerIn   = card.querySelector('.answer-input');
    
    const moveLeftBtn  = card.querySelector('.move-left');
    const moveRightBtn = card.querySelector('.move-right');
    const deleteBtn    = card.querySelector('.delete-btn');

    // -- Movement & Deletion --
    moveLeftBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (card.previousElementSibling) {
            questionGrid.insertBefore(card, card.previousElementSibling);
            updateCardNumbers();
            autoSave();
        }
    });

    moveRightBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (card.nextElementSibling) {
            questionGrid.insertBefore(card.nextElementSibling, card);
            updateCardNumbers();
            autoSave();
        }
    });

    deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        card.remove();
        updateCardNumbers();
        updateCounter();
        updateStartBtn();
        ensureEmptyCardAtEnd();
        autoSave();
    });

    // -- Drag & Drop Reordering (Card) --
    card.addEventListener('dragstart', (e) => {
        if (e.target.closest('.upload-area')) return; // Avoid conflict when trying to drag image itself? Actually card is draggable.
        draggedCard = card;
        card.classList.add('dragging');
    });

    card.addEventListener('dragend', () => {
        draggedCard = null;
        card.classList.remove('dragging');
    });

    card.addEventListener('dragover', (e) => {
        if (!draggedCard || draggedCard === card) return; // Not sorting cards
        e.preventDefault();
        const rect = card.getBoundingClientRect();
        const x = e.clientX - rect.left;
        if (x < rect.width / 2) {
            questionGrid.insertBefore(draggedCard, card);
        } else {
            questionGrid.insertBefore(draggedCard, card.nextSibling);
        }
        updateCardNumbers();
        autoSave();
    });

    // -- File Upload --
    uploadArea.addEventListener('click', () => fileInput.click());

    uploadArea.addEventListener('dragover', (e) => {
        if (draggedCard) return; // Let card dragover handle it
        e.preventDefault();
        uploadArea.classList.add('dragover');
    });
    uploadArea.addEventListener('dragleave', () => uploadArea.classList.remove('dragover'));
    uploadArea.addEventListener('drop', (e) => {
        if (draggedCard) return;
        e.preventDefault();
        uploadArea.classList.remove('dragover');
        if (e.dataTransfer.files[0]) loadImage(e.dataTransfer.files[0], card);
    });

    fileInput.addEventListener('change', (e) => {
        if (e.target.files[0]) loadImage(e.target.files[0], card);
    });

    answerIn.addEventListener('input', () => {
        refreshCardState(card);
        ensureEmptyCardAtEnd();
        autoSave();
    });

    questionGrid.appendChild(card);
    updateStartBtn();
    autoSave();
}

function updateCardNumbers() {
    $$('.question-card').forEach((card, idx) => {
        card.dataset.index = idx;
        card.querySelector('.card-number').textContent = idx + 1;
    });
}

function loadImage(file, card) {
    const reader = new FileReader();
    reader.onload = (e) => {
        const area = card.querySelector('.upload-area');
        area.innerHTML = `<img src="${e.target.result}" alt="질문 이미지">`;
        card.dataset.imageData = e.target.result;
        card.classList.add('has-image');
        refreshCardState(card);
        ensureEmptyCardAtEnd();
        autoSave();
    };
    reader.readAsDataURL(file);
}

function clearCard(card) {
    const area = card.querySelector('.upload-area');
    area.innerHTML = `
        <div class="upload-placeholder">
            <span class="upload-icon">📷</span>
            <span>이미지 업로드</span>
        </div>`;
    delete card.dataset.imageData;
    card.querySelector('.answer-input').value = '';
    card.classList.remove('has-image', 'complete');
    card.querySelector('.file-input').value = '';
    updateCounter();
    updateStartBtn();
}

function refreshCardState(card) {
    const hasImg = !!card.dataset.imageData;
    const hasAns = card.querySelector('.answer-input').value.trim() !== '';
    card.classList.toggle('complete', hasImg && hasAns);
    updateCounter();
    updateStartBtn();
}

function updateStartBtn() {
    const count = $$('.question-card.complete').length;
    startBtn.disabled = count === 0;
}

// ── Bulk Upload ────────────────────────────────────────────

function updateCounter() {
    const count = $$('.question-card.complete').length;
    registeredCount.textContent = count;
}

function handleBulkUpload(e) {
    const files = Array.from(e.target.files);
    if (!files.length) return;

    // 비동기 순차 처리: 하나씩 차례로 로드해야 카드 배정이 정확함
    function processNext(index) {
        if (index >= files.length) {
            bulkFileInput.value = '';
            return;
        }

        const file = files[index];

        // 이미지 없는 카드 중 첫 번째를 찾음
        let targetCard = null;
        $$('.question-card').forEach(card => {
            if (!targetCard && !card.dataset.imageData) {
                targetCard = card;
            }
        });

        if (!targetCard) {
            addCard();
            const all = $$('.question-card');
            targetCard = all[all.length - 1];
        }

        // 이 파일 로드가 완료된 후 다음 파일 처리
        loadImageThen(file, targetCard, () => processNext(index + 1));
    }

    processNext(0);
}

// 이미지 로드 후 콜백 지원 버전
function loadImageThen(file, card, callback) {
    const reader = new FileReader();
    reader.onload = (e) => {
        const area = card.querySelector('.upload-area');
        area.innerHTML = `<img src="${e.target.result}" alt="질문 이미지">`;
        card.dataset.imageData = e.target.result;
        card.classList.add('has-image');
        refreshCardState(card);
        ensureEmptyCardAtEnd();
        autoSave();
        if (callback) callback();
    };
    reader.readAsDataURL(file);
}

// ── Auto Save & Load ───────────────────────────────────────
function autoSave() {
    // Collect all card data
    const data = [];
    $$('.question-card').forEach((card) => {
        const img = card.dataset.imageData;
        const ans = card.querySelector('.answer-input').value.trim();
        if (img || ans) {
            data.push({ image: img || '', answer: ans });
        }
    });

    try {
        localStorage.setItem('pictureQuizCurrentSet', JSON.stringify(data));
    } catch (err) {
        console.warn('LocalStorage save failed:', err);
        // Might be out of space if images are too large
    }
}

function loadFromLocalStorage() {
    try {
        const saved = localStorage.getItem('pictureQuizCurrentSet');
        if (saved) {
            const data = JSON.parse(saved);
            if (Array.isArray(data) && data.length > 0) {
                populateCards(data);
                ensureEmptyCardAtEnd();
                return;
            }
        }
    } catch (err) {
        console.error('Failed to load from local storage', err);
    }
    // Fallback if empty or failed
    questionGrid.innerHTML = '';
    ensureEmptyCardAtEnd();
}

function clearAllData() {
    if (!confirm('현재 작성된 모든 문제와 이미지를 삭제하고 완전히 초기화하시겠습니까?')) return;
    localStorage.removeItem('pictureQuizCurrentSet');
    questionGrid.innerHTML = '';
    ensureEmptyCardAtEnd();
    updateStartBtn();
    updateCounter();
}

function populateCards(data) {
    if (!Array.isArray(data)) {
        alert('잘못된 데이터 형식입니다.');
        return;
    }

    // Clear existing
    questionGrid.innerHTML = '';

    data.forEach((item) => {
        addCard();
        const cards = $$('.question-card');
        const card = cards[cards.length - 1];
        
        if (item.image) {
            const area = card.querySelector('.upload-area');
            area.innerHTML = `<img src="${item.image}" alt="질문 이미지">`;
            card.dataset.imageData = item.image;
            card.classList.add('has-image');
        }
        if (item.answer) {
            card.querySelector('.answer-input').value = item.answer;
        }
        refreshCardState(card);
    });
}


// ── Start Quiz ─────────────────────────────────────────────
function prepareQuiz() {
    state.questions = [];
    $$('.question-card').forEach((card, i) => {
        const img = card.dataset.imageData;
        const ans = card.querySelector('.answer-input').value.trim();
        if (img && ans) {
            state.questions.push({ number: i + 1, image: img, answer: ans });
        }
    });

    if (state.questions.length === 0) {
        alert('최소 1개 이상의 문제를 완성해주세요!\n(이미지 + 정답 모두 필요)');
        return;
    }

    state.timerDuration = Math.max(1, parseInt(timerInput.value) || 5);
    state.currentIndex = 0;

    switchScreen(readyScreen);
}

function startQuiz() {
    switchScreen(quizScreen);
    showQuestion();
}

// ── Quiz Flow ──────────────────────────────────────────────
function showQuestion() {
    const q = state.questions[state.currentIndex];

    questionNumber.textContent = `Q.${q.number}`;
    quizProgress.textContent = `${state.currentIndex + 1} / ${state.questions.length}`;
    quizImage.src = q.image;

    // Reset overlays
    answerOverlay.classList.remove('active');
    explosionOverlay.classList.remove('active');
    explosionOverlay.innerHTML = '';

    // Re-trigger image animation
    const container = $('#image-container');
    container.style.animation = 'none';
    void container.offsetHeight;
    container.style.animation = '';

    // Reset pause
    state.isPaused = false;
    pauseBtn.textContent = '⏸ 일시정지';
    pauseBtn.classList.remove('paused');

    startBombTimer();
}

// ── Bomb Timer ─────────────────────────────────────────────
function startBombTimer() {
    state.timerRemaining = state.timerDuration;

    const r = 54;
    const C = 2 * Math.PI * r;

    bombContainer.innerHTML = `
        <div class="bomb-timer" id="bomb-timer-el">
            <div class="fuse-spark"></div>
            <svg viewBox="0 0 120 120">
                <circle class="timer-track" cx="60" cy="60" r="${r}" />
                <circle class="timer-progress" id="timer-ring" cx="60" cy="60" r="${r}"
                    stroke-dasharray="${C}"
                    stroke-dashoffset="0"
                    stroke="${timerColor(1)}" />
            </svg>
            <div class="timer-center">
                <span class="bomb-emoji">💣</span>
                <span class="timer-number" id="timer-num">${state.timerDuration}</span>
            </div>
        </div>`;

    const ring    = $('#timer-ring');
    const numEl   = $('#timer-num');
    const bombEl  = $('#bomb-timer-el');

    // Initial tick
    playTick(1);

    state.timerInterval = setInterval(() => {
        if (state.isPaused) return;

        state.timerRemaining--;

        const frac = state.timerRemaining / state.timerDuration;
        ring.style.strokeDashoffset = C * (1 - frac);
        ring.style.stroke = timerColor(frac);
        numEl.textContent = state.timerRemaining;
        numEl.style.color = timerColor(frac);

        // Urgency classes
        if (frac <= 0.25) {
            bombEl.className = 'bomb-timer bomb-urgent';
        } else if (frac <= 0.5) {
            bombEl.className = 'bomb-timer bomb-shake';
        }

        if (state.timerRemaining > 0) {
            playTick(frac);
        }

        if (state.timerRemaining <= 0) {
            clearInterval(state.timerInterval);
            state.timerInterval = null;
            explode();
        }
    }, 1000);
}

function togglePause() {
    if (state.timerRemaining <= 0) return; // Cannot pause after explosion
    state.isPaused = !state.isPaused;
    
    if (state.isPaused) {
        pauseBtn.textContent = '▶ 계속하기';
        pauseBtn.classList.add('paused');
    } else {
        pauseBtn.textContent = '⏸ 일시정지';
        pauseBtn.classList.remove('paused');
    }
}

function timerColor(frac) {
    if (frac > 0.6)  return '#4ade80';
    if (frac > 0.3)  return '#fbbf24';
    return '#ef4444';
}

// ── Explosion ──────────────────────────────────────────────
function explode() {
    playExplosion();

    // Compute bomb center for particle origin
    const bombRect = bombContainer.getBoundingClientRect();
    const cx = bombRect.left + bombRect.width / 2;
    const cy = bombRect.top  + bombRect.height / 2;
    const pctX = ((cx / window.innerWidth) * 100).toFixed(1) + '%';
    const pctY = ((cy / window.innerHeight) * 100).toFixed(1) + '%';

    // Flash
    const flash = document.createElement('div');
    flash.className = 'explosion-flash';
    flash.style.setProperty('--cx', pctX);
    flash.style.setProperty('--cy', pctY);

    // Boom text
    const boom = document.createElement('div');
    boom.className = 'boom-text';
    boom.textContent = 'BOOM!';
    boom.style.setProperty('--cx', pctX);
    boom.style.setProperty('--cy', pctY);
    boom.style.left = pctX;
    boom.style.top  = pctY;

    explosionOverlay.innerHTML = '';
    explosionOverlay.appendChild(flash);
    explosionOverlay.appendChild(boom);

    // Particles
    const colors = ['#ff6b35', '#ff4444', '#fbbf24', '#ff8c42', '#fff', '#ff2d2d'];
    for (let i = 0; i < 50; i++) {
        const p = document.createElement('div');
        p.className = 'particle';
        const size = Math.random() * 14 + 4;
        const angle = (Math.PI * 2 * i) / 50 + Math.random() * 0.4;
        const dist = Math.random() * 350 + 80;

        p.style.cssText = `
            left: ${cx}px;
            top: ${cy}px;
            width: ${size}px;
            height: ${size}px;
            background: ${colors[Math.floor(Math.random() * colors.length)]};
            --tx: ${Math.cos(angle) * dist}px;
            --ty: ${Math.sin(angle) * dist}px;
            --dur: ${0.5 + Math.random() * 0.7}s;
        `;
        explosionOverlay.appendChild(p);
    }

    explosionOverlay.classList.add('active');

    // Screen shake
    quizScreen.classList.add('screen-shake');
    setTimeout(() => quizScreen.classList.remove('screen-shake'), 600);

    // Hide bomb
    bombContainer.innerHTML = '';

    // Show answer after brief pause
    setTimeout(showAnswer, 900);
}

// ── Answer ─────────────────────────────────────────────────
function showAnswer() {
    const q = state.questions[state.currentIndex];
    answerText.textContent = q.answer;
    answerOverlay.classList.add('active');

    if (state.currentIndex >= state.questions.length - 1) {
        nextBtn.textContent = '🎉 결과 보기';
    } else {
        nextBtn.textContent = '다음 문제 →';
    }
}

function nextQuestion() {
    state.currentIndex++;
    if (state.currentIndex >= state.questions.length) {
        endTotal.textContent = state.questions.length;
        switchScreen(endScreen);
        launchConfetti();
    } else {
        showQuestion();
    }
}

// ── Restart ────────────────────────────────────────────────
function restart() {
    if (state.timerInterval) clearInterval(state.timerInterval);
    state.timerInterval = null;
    switchScreen(setupScreen);
}

// ── Screen Switch ──────────────────────────────────────────
function switchScreen(target) {
    $$('.screen').forEach((s) => s.classList.remove('active'));
    target.classList.add('active');
}

// ── Audio helpers ──────────────────────────────────────────
function getAudioCtx() {
    if (!state.audioCtx) {
        state.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    // Resume if suspended (Safari)
    if (state.audioCtx.state === 'suspended') state.audioCtx.resume();
    return state.audioCtx;
}

function playTick(frac) {
    try {
        const ctx  = getAudioCtx();
        const osc  = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.frequency.value = frac > 0.3 ? 800 : 1200;
        osc.type = 'sine';
        gain.gain.setValueAtTime(0.12, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);

        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.08);
    } catch (_) { /* audio unavailable */ }
}

function playExplosion() {
    try {
        const ctx = getAudioCtx();
        const len = ctx.sampleRate * 0.6;
        const buf = ctx.createBuffer(1, len, ctx.sampleRate);
        const d   = buf.getChannelData(0);
        for (let i = 0; i < len; i++) {
            d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 1.8);
        }

        const src    = ctx.createBufferSource();
        src.buffer   = buf;

        const filter = ctx.createBiquadFilter();
        filter.type  = 'lowpass';
        filter.frequency.value = 500;

        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.6, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);

        src.connect(filter);
        filter.connect(gain);
        gain.connect(ctx.destination);
        src.start();
    } catch (_) { /* audio unavailable */ }
}

// ── Confetti (End Screen) ──────────────────────────────────
function launchConfetti() {
    const canvas = $('#confetti-canvas');
    if (!canvas) return;
    const ctx2d = canvas.getContext('2d');
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;

    const pieces = [];
    const colors = ['#ff6b35', '#ff4444', '#fbbf24', '#4ade80', '#60a5fa', '#c084fc', '#fff'];

    for (let i = 0; i < 120; i++) {
        pieces.push({
            x: Math.random() * canvas.width,
            y: Math.random() * -canvas.height,
            w: Math.random() * 10 + 5,
            h: Math.random() * 6 + 3,
            color: colors[Math.floor(Math.random() * colors.length)],
            vx: (Math.random() - 0.5) * 3,
            vy: Math.random() * 3 + 2,
            rot: Math.random() * 360,
            rv: (Math.random() - 0.5) * 8,
            opacity: 1,
        });
    }

    let frame = 0;
    function draw() {
        ctx2d.clearRect(0, 0, canvas.width, canvas.height);
        let alive = false;
        pieces.forEach((p) => {
            if (p.opacity <= 0) return;
            alive = true;
            p.x += p.vx;
            p.y += p.vy;
            p.vy += 0.04;
            p.rot += p.rv;
            if (p.y > canvas.height + 50) p.opacity -= 0.02;

            ctx2d.save();
            ctx2d.globalAlpha = Math.max(0, p.opacity);
            ctx2d.translate(p.x, p.y);
            ctx2d.rotate((p.rot * Math.PI) / 180);
            ctx2d.fillStyle = p.color;
            ctx2d.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
            ctx2d.restore();
        });
        frame++;
        if (alive && frame < 400) requestAnimationFrame(draw);
    }
    requestAnimationFrame(draw);
}

// ── Keyboard shortcuts (quiz) ──────────────────────────────
document.addEventListener('keydown', (e) => {
    if (e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowRight') {
        if (answerOverlay.classList.contains('active')) {
            e.preventDefault();
            nextQuestion();
        }
    }
});

// ── Boot ───────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);
