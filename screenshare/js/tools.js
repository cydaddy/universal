/* ============================================
   Tools - 교실 도구 모음
   타이머, 랜덤 선택, 주의 집중, 스냅샷 등
   ============================================ */

class Tools {
  constructor() {
    // Timer state
    this.timerInterval = null;
    this.timerSeconds = 300; // default 5 min
    this.timerRemaining = 300;
    this.timerRunning = false;

    // Callbacks
    this.onTimerTick = null;       // (remaining, total) => {}
    this.onTimerEnd = null;        // () => {}
    this.onSendCommand = null;     // (command) => {} - broadcast to students

    // Audio context for sounds
    this._audioCtx = null;
  }

  /* ------------------------------------------
     TIMER
     ------------------------------------------ */

  /**
   * 타이머 시간 설정
   */
  setTimer(seconds) {
    this.timerSeconds = seconds;
    this.timerRemaining = seconds;
    this._updateTimerDisplay();
  }

  /**
   * 타이머 시작
   */
  startTimer() {
    if (this.timerRunning) return;

    this.timerRunning = true;

    // Broadcast to students
    if (this.onSendCommand) {
      this.onSendCommand({
        type: 'timer',
        data: {
          action: 'start',
          remaining: this.timerRemaining,
          total: this.timerSeconds
        }
      });
    }

    this.timerInterval = setInterval(() => {
      this.timerRemaining--;

      if (this.timerRemaining <= 0) {
        this.timerRemaining = 0;
        this.stopTimer();
        this._playTimerEndSound();

        if (this.onTimerEnd) {
          this.onTimerEnd();
        }

        // Notify students
        if (this.onSendCommand) {
          this.onSendCommand({
            type: 'timer',
            data: { action: 'end' }
          });
        }
        return;
      }

      this._updateTimerDisplay();

      // Sync to students every 10 seconds
      if (this.timerRemaining % 10 === 0 && this.onSendCommand) {
        this.onSendCommand({
          type: 'timer',
          data: {
            action: 'sync',
            remaining: this.timerRemaining,
            total: this.timerSeconds
          }
        });
      }
    }, 1000);
  }

  /**
   * 타이머 일시정지
   */
  pauseTimer() {
    if (!this.timerRunning) return;

    this.timerRunning = false;
    clearInterval(this.timerInterval);
    this.timerInterval = null;

    if (this.onSendCommand) {
      this.onSendCommand({
        type: 'timer',
        data: {
          action: 'pause',
          remaining: this.timerRemaining
        }
      });
    }
  }

  /**
   * 타이머 중지/리셋
   */
  stopTimer() {
    this.timerRunning = false;
    clearInterval(this.timerInterval);
    this.timerInterval = null;
    this.timerRemaining = this.timerSeconds;
    this._updateTimerDisplay();

    if (this.onSendCommand) {
      this.onSendCommand({
        type: 'timer',
        data: { action: 'stop' }
      });
    }
  }

  _updateTimerDisplay() {
    if (this.onTimerTick) {
      this.onTimerTick(this.timerRemaining, this.timerSeconds);
    }
  }

  /**
   * 시간을 MM:SS 포맷으로 변환
   */
  static formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  /* ------------------------------------------
     RANDOM STUDENT PICKER
     ------------------------------------------ */

  /**
   * 랜덤 학생 선택 (슬롯머신 애니메이션)
   * @param {Array<{peerId, name}>} students - 학생 목록
   * @param {Function} onUpdate - (name) => {} 매 프레임
   * @param {Function} onComplete - (student) => {} 최종 결과
   */
  pickRandomStudent(students, onUpdate, onComplete) {
    if (!students || students.length === 0) return;

    const totalFrames = 30;
    const initialDelay = 50;
    let frame = 0;

    // Select random winner
    const winnerIndex = Math.floor(Math.random() * students.length);
    const winner = students[winnerIndex];

    const spin = () => {
      frame++;
      const delay = initialDelay + (frame * frame * 2); // quadratic slowdown
      const index = frame % students.length;

      if (onUpdate) {
        onUpdate(students[index].name);
      }

      if (frame >= totalFrames) {
        // Final selection
        if (onUpdate) onUpdate(winner.name);
        if (onComplete) onComplete(winner);
        this._playPickerSound();
        return;
      }

      setTimeout(spin, delay);
    };

    spin();
  }

  /* ------------------------------------------
     ATTENTION SIGNAL
     ------------------------------------------ */

  /**
   * 주의 집중 신호 보내기
   */
  sendAttention() {
    if (this.onSendCommand) {
      this.onSendCommand({
        type: 'attention',
        data: {}
      });
    }
    this._playAttentionSound();
  }

  /**
   * 학생 측: 주의 집중 오버레이 표시
   */
  static showAttentionOverlay() {
    const overlay = document.getElementById('attention-overlay');
    if (!overlay) return;

    // Remove and re-add to restart animation
    overlay.classList.remove('active');
    void overlay.offsetWidth; // force reflow
    overlay.classList.add('active');

    setTimeout(() => {
      overlay.classList.remove('active');
    }, 3000);
  }

  /* ------------------------------------------
     SCREEN LOCK
     ------------------------------------------ */

  /**
   * 화면 잠금 토글
   */
  toggleLock(locked) {
    if (this.onSendCommand) {
      this.onSendCommand({
        type: 'lock',
        data: { locked }
      });
    }
  }

  /**
   * 학생 측: 잠금 오버레이 표시/숨기기
   */
  static showLockOverlay(locked) {
    const overlay = document.getElementById('lock-overlay');
    if (!overlay) return;

    if (locked) {
      overlay.classList.add('active');
    } else {
      overlay.classList.remove('active');
    }
  }

  /* ------------------------------------------
     SCREENSHOT
     ------------------------------------------ */

  /**
   * 비디오 요소를 캡처하여 다운로드
   */
  static captureScreenshot(videoElement, studentName) {
    if (!videoElement || !videoElement.videoWidth) return;

    const canvas = document.createElement('canvas');
    canvas.width = videoElement.videoWidth;
    canvas.height = videoElement.videoHeight;

    const ctx = canvas.getContext('2d');
    ctx.drawImage(videoElement, 0, 0);

    // Add student name watermark
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.fillRect(0, canvas.height - 40, canvas.width, 40);
    ctx.fillStyle = 'white';
    ctx.font = '16px Inter, sans-serif';
    ctx.fillText(
      `${studentName} - ${new Date().toLocaleString('ko-KR')}`,
      10,
      canvas.height - 14
    );

    // Download
    const link = document.createElement('a');
    link.download = `parkshare_${studentName}_${Date.now()}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  }

  /* ------------------------------------------
     CONFETTI EFFECT
     ------------------------------------------ */

  static showConfetti() {
    const container = document.getElementById('confetti-container');
    if (!container) return;

    const colors = ['#6366f1', '#8b5cf6', '#06b6d4', '#10b981', '#f59e0b', '#ef4444', '#ec4899'];
    const pieces = 40;

    for (let i = 0; i < pieces; i++) {
      const piece = document.createElement('div');
      piece.className = 'confetti-piece';
      piece.style.left = `${Math.random() * 100}%`;
      piece.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
      piece.style.animationDelay = `${Math.random() * 0.5}s`;
      piece.style.animationDuration = `${2 + Math.random() * 2}s`;
      piece.style.width = `${6 + Math.random() * 8}px`;
      piece.style.height = `${6 + Math.random() * 8}px`;
      container.appendChild(piece);

      setTimeout(() => piece.remove(), 4000);
    }
  }

  /* ------------------------------------------
     SOUND EFFECTS (Web Audio API)
     ------------------------------------------ */

  _getAudioContext() {
    if (!this._audioCtx) {
      this._audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    return this._audioCtx;
  }

  _playTone(frequency, duration, type = 'sine') {
    try {
      const ctx = this._getAudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.frequency.value = frequency;
      osc.type = type;
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + duration);

      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + duration);
    } catch (e) {
      console.warn('[Tools] Audio play failed:', e);
    }
  }

  _playAttentionSound() {
    this._playTone(880, 0.15, 'square');
    setTimeout(() => this._playTone(1100, 0.15, 'square'), 150);
    setTimeout(() => this._playTone(880, 0.15, 'square'), 300);
  }

  _playTimerEndSound() {
    for (let i = 0; i < 3; i++) {
      setTimeout(() => {
        this._playTone(660, 0.3, 'sine');
      }, i * 400);
    }
  }

  _playPickerSound() {
    this._playTone(523, 0.1);
    setTimeout(() => this._playTone(659, 0.1), 100);
    setTimeout(() => this._playTone(784, 0.1), 200);
    setTimeout(() => this._playTone(1047, 0.3), 300);
  }

  /* ------------------------------------------
     STUDENT-SIDE TIMER MANAGEMENT
     ------------------------------------------ */

  /**
   * 학생 측: 타이머 명령 처리
   */
  handleTimerCommand(data) {
    const floatingTimer = document.getElementById('floating-timer');
    const floatingValue = document.getElementById('floating-timer-value');
    if (!floatingTimer || !floatingValue) return;

    switch (data.action) {
      case 'start':
      case 'sync':
        this.timerRemaining = data.remaining;
        this.timerSeconds = data.total || data.remaining;
        floatingTimer.classList.add('active');
        floatingValue.textContent = Tools.formatTime(this.timerRemaining);

        // Start local countdown for smooth display
        if (this.timerInterval) clearInterval(this.timerInterval);
        this.timerRunning = true;
        this.timerInterval = setInterval(() => {
          this.timerRemaining--;
          if (this.timerRemaining <= 0) {
            this.timerRemaining = 0;
            clearInterval(this.timerInterval);
            this.timerRunning = false;
            this._playTimerEndSound();
          }
          floatingValue.textContent = Tools.formatTime(this.timerRemaining);
          floatingValue.classList.toggle('warning', this.timerRemaining <= 10);
        }, 1000);
        break;

      case 'pause':
        if (this.timerInterval) clearInterval(this.timerInterval);
        this.timerRunning = false;
        if (data.remaining !== undefined) {
          this.timerRemaining = data.remaining;
          floatingValue.textContent = Tools.formatTime(this.timerRemaining);
        }
        break;

      case 'stop':
      case 'end':
        if (this.timerInterval) clearInterval(this.timerInterval);
        this.timerRunning = false;
        floatingTimer.classList.remove('active');
        if (data.action === 'end') {
          this._playTimerEndSound();
        }
        break;
    }
  }

  /**
   * 정리
   */
  destroy() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
    }
    if (this._audioCtx) {
      this._audioCtx.close();
    }
  }
}

// Export globally
window.Tools = Tools;
