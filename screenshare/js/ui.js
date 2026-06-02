/* ============================================
   UI - 화면 렌더링 및 인터랙션 관리
   그리드 레이아웃, 스포트라이트, 토스트 등
   ============================================ */

class UI {
  constructor() {
    // DOM References
    this.screenGrid = document.getElementById('screen-grid');
    this.emptyState = document.getElementById('empty-state');
    this.spotlightOverlay = document.getElementById('spotlight-overlay');
    this.spotlightVideo = document.getElementById('spotlight-video');
    this.spotlightName = document.getElementById('spotlight-name');
    this.spotlightThumbnails = document.getElementById('spotlight-thumbnails');
    this.toastContainer = document.getElementById('toast-container');
    this.comparisonOverlay = document.getElementById('comparison-overlay');
    this.comparisonGrid = document.getElementById('comparison-grid');
    this.comparisonTitle = document.getElementById('comparison-title');

    // State
    this.cards = new Map(); // peerId → DOM element
    this.gridMode = 'auto';
    this.spotlightPeerId = null;
    this.selectedPeers = new Set(); // peerId set for comparison

    // Callbacks
    this.onCardClick = null;       // (peerId) => {}
    this.onSnapshot = null;        // (peerId, videoEl) => {}
    this.onKick = null;            // (peerId) => {}
    this.onSelectionChanged = null; // (selectedCount) => {}
  }

  /* ------------------------------------------
     GRID MANAGEMENT
     ------------------------------------------ */

  /**
   * 그리드 모드 설정
   */
  setGridMode(mode) {
    this.gridMode = mode;
    this._updateGridColumns();

    // Update grid selector buttons
    document.querySelectorAll('.grid-option').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.grid === mode);
    });
  }

  /**
   * 그리드 컬럼 수 업데이트
   */
  _updateGridColumns() {
    let cols;
    const count = this.cards.size || 1;

    if (this.gridMode === 'auto') {
      if (count <= 1) cols = 1;
      else if (count <= 4) cols = 2;
      else if (count <= 9) cols = 3;
      else if (count <= 16) cols = 4;
      else cols = 5;
    } else {
      cols = parseInt(this.gridMode);
    }

    const rows = Math.max(1, Math.ceil(count / cols));

    this.screenGrid.style.setProperty('--grid-cols', cols);
    this.screenGrid.style.setProperty('--grid-rows', rows);
  }

  /* ------------------------------------------
     STUDENT CARDS
     ------------------------------------------ */

  /**
   * 학생 카드 추가
   */
  addStudentCard(peerId, name) {
    // Hide empty state
    if (this.emptyState) {
      this.emptyState.style.display = 'none';
    }

    // Check if card already exists
    if (this.cards.has(peerId)) {
      this.updateStudentName(peerId, name);
      return;
    }

    const card = document.createElement('div');
    card.className = 'screen-card';
    card.id = `card-${peerId}`;
    card.dataset.peerId = peerId;

    card.innerHTML = `
      <div class="card-checkbox-container">
        <input type="checkbox" class="card-checkbox" data-action="select" title="집중 모니터링 비교 선택">
      </div>
      <div class="no-stream">
        <span class="no-stream-icon">⏳</span>
        <span>화면 공유 대기중...</span>
      </div>
      <video autoplay playsinline muted></video>
      <div class="card-label">
        <span class="student-name">
          <span class="card-status waiting"></span>
          ${this._escapeHtml(name)}
        </span>
      </div>
      <div class="card-actions">
        <button class="card-action-btn" data-action="snapshot" title="스냅샷">📸</button>
        <button class="card-action-btn" data-action="kick" title="내보내기">❌</button>
      </div>
    `;

    // Card checkbox click handler
    const checkbox = card.querySelector('.card-checkbox');
    if (checkbox) {
      checkbox.addEventListener('click', (e) => {
        e.stopPropagation(); // Prevent spotlight view on checkmark toggle
        
        const isChecked = checkbox.checked;
        card.classList.toggle('selected-for-compare', isChecked);
        
        if (isChecked) {
          this.selectedPeers.add(peerId);
        } else {
          this.selectedPeers.delete(peerId);
        }
        
        if (this.onSelectionChanged) {
          this.onSelectionChanged(this.selectedPeers.size);
        }
      });
    }

    // Card click → spotlight
    card.addEventListener('click', (e) => {
      // Don't trigger spotlight on action buttons or checkboxes
      if (e.target.closest('.card-action-btn')) return;
      if (e.target.closest('.card-checkbox-container')) return;
      if (this.onCardClick) {
        this.onCardClick(peerId);
      }
    });

    // Action buttons
    card.querySelectorAll('.card-action-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const action = btn.dataset.action;
        if (action === 'snapshot' && this.onSnapshot) {
          const video = card.querySelector('video');
          this.onSnapshot(peerId, video);
        } else if (action === 'kick' && this.onKick) {
          this.onKick(peerId);
        }
      });
    });

    this.screenGrid.appendChild(card);
    this.cards.set(peerId, card);
    this._updateGridColumns();
    this._updateStudentCount();
  }

  /**
   * 학생 카드 제거
   */
  removeStudentCard(peerId) {
    const card = this.cards.get(peerId);
    if (card) {
      // Fade out from comparison selection if it was checked
      if (this.selectedPeers.has(peerId)) {
        this.selectedPeers.delete(peerId);
        if (this.onSelectionChanged) {
          this.onSelectionChanged(this.selectedPeers.size);
        }
      }

      // Fade out animation
      card.style.transition = 'all 0.3s ease-out';
      card.style.opacity = '0';
      card.style.transform = 'scale(0.9)';

      setTimeout(() => {
        card.remove();
        this.cards.delete(peerId);
        this._updateGridColumns();
        this._updateStudentCount();

        // Show empty state if no cards
        if (this.cards.size === 0 && this.emptyState) {
          this.emptyState.style.display = '';
        }
      }, 300);
    }

    // Close spotlight if viewing this student
    if (this.spotlightPeerId === peerId) {
      this.closeSpotlight();
    }

    // Close compare card in comparison grid if open
    const compareCard = document.getElementById(`compare-card-${peerId}`);
    if (compareCard) {
      compareCard.remove();
      // Recalculate comparison grid columns
      this._updateComparisonGridColumns();
    }
  }

  /**
   * 학생 이름 업데이트
   */
  updateStudentName(peerId, name) {
    const card = this.cards.get(peerId);
    if (card) {
      const nameEl = card.querySelector('.student-name');
      const statusEl = nameEl.querySelector('.card-status');
      nameEl.textContent = '';
      nameEl.appendChild(statusEl);
      nameEl.appendChild(document.createTextNode(this._escapeHtml(name)));
    }
  }

  /**
   * 학생 카드에 비디오 스트림 연결
   */
  setCardStream(peerId, stream) {
    const card = this.cards.get(peerId);
    if (!card) return;

    const video = card.querySelector('video');
    const noStream = card.querySelector('.no-stream');
    const statusDot = card.querySelector('.card-status');

    if (stream) {
      video.srcObject = stream;
      video.style.display = 'block';
      if (noStream) noStream.style.display = 'none';
      if (statusDot) {
        statusDot.className = 'card-status sharing';
      }
    } else {
      video.srcObject = null;
      video.style.display = 'none';
      if (noStream) noStream.style.display = '';
      if (statusDot) {
        statusDot.className = 'card-status waiting';
      }
    }

    // Update spotlight if active
    if (this.spotlightPeerId === peerId && stream) {
      this.spotlightVideo.srcObject = stream;
    }

    // Dynamic sync to comparison view card if active
    const compareCard = document.getElementById(`compare-card-${peerId}`);
    if (compareCard) {
      const compareVideo = compareCard.querySelector('video');
      const compareNoStream = compareCard.querySelector('.no-stream');
      const compareStatusDot = compareCard.querySelector('.card-status');

      if (stream) {
        compareVideo.srcObject = stream;
        compareVideo.style.display = 'block';
        if (compareNoStream) compareNoStream.style.display = 'none';
        if (compareStatusDot) {
          compareStatusDot.className = 'card-status sharing';
        }
      } else {
        compareVideo.srcObject = null;
        compareVideo.style.display = 'none';
        if (compareNoStream) compareNoStream.style.display = '';
        if (compareStatusDot) {
          compareStatusDot.className = 'card-status waiting';
        }
      }
    }
  }

  /**
   * 학생 수 표시 업데이트
   */
  _updateStudentCount() {
    const countEl = document.getElementById('student-count-text');
    if (countEl) {
      countEl.textContent = `${this.cards.size}명 접속`;
    }
  }

  /* ------------------------------------------
     SPOTLIGHT
     ------------------------------------------ */

  /**
   * 스포트라이트 열기
   */
  openSpotlight(peerId, name, stream) {
    this.spotlightPeerId = peerId;

    // Set main video
    if (stream) {
      this.spotlightVideo.srcObject = stream;
    }

    // Set name
    this.spotlightName.innerHTML = `<span>🔍</span><span>${this._escapeHtml(name)}</span>`;

    // Build thumbnails
    this._buildSpotlightThumbnails(peerId);

    // Show overlay
    this.spotlightOverlay.classList.add('active');
  }

  /**
   * 스포트라이트에서 다른 학생으로 전환
   */
  switchSpotlight(peerId) {
    const card = this.cards.get(peerId);
    if (!card) return;

    this.spotlightPeerId = peerId;
    const video = card.querySelector('video');
    const name = card.querySelector('.student-name')?.textContent?.trim() || '';

    if (video.srcObject) {
      this.spotlightVideo.srcObject = video.srcObject;
    }

    this.spotlightName.innerHTML = `<span>🔍</span><span>${this._escapeHtml(name)}</span>`;

    // Update thumbnail active state
    this.spotlightThumbnails.querySelectorAll('.spotlight-thumb').forEach(thumb => {
      thumb.classList.toggle('active', thumb.dataset.peerId === peerId);
    });
  }

  /**
   * 스포트라이트 닫기
   */
  closeSpotlight() {
    this.spotlightPeerId = null;
    this.spotlightOverlay.classList.remove('active');
    this.spotlightVideo.srcObject = null;
    this.spotlightThumbnails.innerHTML = '';
  }

  /**
   * 스포트라이트 썸네일 목록 생성
   */
  _buildSpotlightThumbnails(activePeerId) {
    this.spotlightThumbnails.innerHTML = '';

    for (const [peerId, card] of this.cards) {
      const thumb = document.createElement('div');
      thumb.className = `spotlight-thumb ${peerId === activePeerId ? 'active' : ''}`;
      thumb.dataset.peerId = peerId;

      const video = card.querySelector('video');
      const name = card.querySelector('.student-name')?.textContent?.trim() || '';

      // Clone video stream for thumbnail
      const thumbVideo = document.createElement('video');
      thumbVideo.autoplay = true;
      thumbVideo.muted = true;
      thumbVideo.playsInline = true;
      if (video.srcObject) {
        thumbVideo.srcObject = video.srcObject;
      }

      const thumbName = document.createElement('div');
      thumbName.className = 'thumb-name';
      thumbName.textContent = name;

      thumb.appendChild(thumbVideo);
      thumb.appendChild(thumbName);

      thumb.addEventListener('click', () => {
        this.switchSpotlight(peerId);
      });

      this.spotlightThumbnails.appendChild(thumb);
    }
  }

  /* ------------------------------------------
     TOASTS
     ------------------------------------------ */

  /**
   * 토스트 알림 표시
   */
  showToast(message, type = 'info', duration = 3000) {
    const icons = {
      success: '✅',
      error: '❌',
      info: 'ℹ️',
      warning: '⚠️'
    };

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
      <span class="toast-icon">${icons[type] || icons.info}</span>
      <span>${this._escapeHtml(message)}</span>
    `;

    this.toastContainer.appendChild(toast);

    // Auto-remove
    setTimeout(() => {
      toast.classList.add('removing');
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }

  /* ------------------------------------------
     STATUS UPDATES
     ------------------------------------------ */

  /**
   * 로비 연결 상태 업데이트
   */
  updateLobbyStatus(status, text) {
    const dot = document.getElementById('lobby-status-dot');
    const textEl = document.getElementById('lobby-status-text');

    if (dot) {
      dot.className = `status-dot ${status}`;
    }
    if (textEl && text) {
      textEl.textContent = text;
    }
  }

  /**
   * 학생 연결 상태 업데이트
   */
  updateStudentStatus(status, text) {
    const dot = document.getElementById('student-status-dot');
    const textEl = document.getElementById('student-status-text');

    if (dot) {
      dot.className = `status-dot ${status}`;
    }
    if (textEl && text) {
      textEl.textContent = text;
    }
  }

  /* ------------------------------------------
     VIEW MANAGEMENT
     ------------------------------------------ */

  /**
   * 뷰 전환
   */
  switchView(viewId) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    const targetView = document.getElementById(viewId);
    if (targetView) {
      targetView.classList.add('active');
    }
  }

  /* ------------------------------------------
     UTILITIES
     ------------------------------------------ */

  _escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * 방 코드 표시
   */
  displayRoomCode(code) {
    const el = document.getElementById('display-room-code');
    if (el) el.textContent = code;

    const studentEl = document.getElementById('student-room-code');
    if (studentEl) studentEl.textContent = code;
  }

  /**
   * 방 코드 클립보드 복사
   */
  async copyRoomCode(code) {
    try {
      await navigator.clipboard.writeText(code);
      this.showToast('방 코드가 복사되었습니다!', 'success');
    } catch {
      // Fallback for non-HTTPS
      const input = document.createElement('input');
      input.value = code;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      input.remove();
      this.showToast('방 코드가 복사되었습니다!', 'success');
    }
  }

  /**
   * 비교 오버레이 열기 및 선택 학생 실시간 화면 연동
   */
  openComparisonOverlay() {
    if (this.selectedPeers.size === 0) return;

    this.comparisonGrid.innerHTML = '';
    this.spotlightPeerId = null;

    let count = 0;
    for (const peerId of this.selectedPeers) {
      const originalCard = this.cards.get(peerId);
      if (!originalCard) continue;

      const studentName = originalCard.querySelector('.student-name').textContent.trim();
      const originalVideo = originalCard.querySelector('video');

      const compareCard = document.createElement('div');
      compareCard.className = 'screen-card';
      compareCard.id = `compare-card-${peerId}`;

      compareCard.innerHTML = `
        <div class="no-stream" style="display: ${originalVideo.srcObject ? 'none' : ''}">
          <span class="no-stream-icon">⏳</span>
          <span>화면 공유 대기중...</span>
        </div>
        <video autoplay playsinline muted style="display: ${originalVideo.srcObject ? 'block' : 'none'}"></video>
        <div class="card-label">
          <span class="student-name">
            <span class="card-status ${originalVideo.srcObject ? 'sharing' : 'waiting'}"></span>
            ${this._escapeHtml(studentName)}
          </span>
        </div>
      `;

      if (originalVideo.srcObject) {
        const compareVideo = compareCard.querySelector('video');
        compareVideo.srcObject = originalVideo.srcObject;
      }

      this.comparisonGrid.appendChild(compareCard);
      count++;
    }

    this._updateComparisonGridColumns();
    this.comparisonTitle.innerHTML = `<span>👁️</span> <span>선택 화면 집중 모니터링 (${count}명)</span>`;
    this.comparisonOverlay.classList.add('active');
  }

  /**
   * 비교 오버레이 컬럼/로우 격자 구조 동적 업데이트
   */
  _updateComparisonGridColumns() {
    const count = this.comparisonGrid.children.length;
    if (count === 0) return;

    let cols = 1;
    if (count <= 1) cols = 1;
    else if (count <= 2) cols = 2;
    else if (count <= 4) cols = 2;
    else if (count <= 6) cols = 3;
    else if (count <= 9) cols = 3;
    else cols = 4;

    const rows = Math.max(1, Math.ceil(count / cols));
    this.comparisonGrid.style.setProperty('--grid-cols', cols);
    this.comparisonGrid.style.setProperty('--grid-rows', rows);
  }

  /**
   * 비교 오버레이 닫기 및 미디어 리소스 비우기
   */
  closeComparisonOverlay() {
    this.comparisonOverlay.classList.remove('active');
    this.comparisonGrid.querySelectorAll('video').forEach(v => {
      v.srcObject = null;
    });
    this.comparisonGrid.innerHTML = '';
  }

  /**
   * 정리
   */
  destroy() {
    this.cards.clear();
    this.closeSpotlight();
  }
}

// Export globally
window.UI = UI;
