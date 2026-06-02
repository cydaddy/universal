/* ============================================
   TeacherApp - 교사용 애플리케이션 컨트롤러
   교사 전용 대시보드 관리 및 이벤트 바인딩
   ============================================ */

(function () {
  'use strict';

  // --- State ---
  const state = {
    role: 'teacher',
    classroomKey: null,
  };

  // --- Modules ---
  const peerManager = new PeerManager();
  const tools = new Tools();
  const ui = new UI();

  /* ------------------------------------------
     INITIALIZATION
     ------------------------------------------ */

  function init() {
    bindTeacherEvents();
    setupPeerCallbacks();
    setupUICallbacks();

    // 수업 시작 즉시 자동 연결
    startTeacherDashboard();

    console.log('[ParkShare] Teacher App initialized');
  }

  /* ------------------------------------------
     TEACHER DASHBOARD START
     ------------------------------------------ */

  async function startTeacherDashboard() {
    ui.showToast('서버 연결을 초기화하는 중입니다...', 'info');

    try {
      // 교사로 방 생성 (이름: 선생님)
      state.classroomKey = await peerManager.createRoom('선생님');
      ui.showToast('수업이 성공적으로 시작되었습니다!', 'success');

      // 학생 접속 주소 설정
      setupStudentUrl();
    } catch (err) {
      console.error('[TeacherApp] Class start failed:', err);
      ui.showToast('서버 연결에 실패했습니다. 페이지를 새로고침해 주세요.', 'error');
    }
  }

  function setupStudentUrl() {
    const studentUrl = new URL('student.html', window.location.href).href;
    const urlEl = document.getElementById('display-student-url');
    if (urlEl) {
      // 호스트네임이 있으면 간결하게 표시, 없으면 파일명 표시
      urlEl.textContent = window.location.hostname ? `${window.location.hostname}/student.html` : 'student.html';
    }

    const guideBtn = document.getElementById('student-guide-btn');
    if (guideBtn) {
      guideBtn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(studentUrl);
          ui.showToast('학생 접속 주소가 복사되었습니다!', 'success');
        } catch {
          // Fallback 복사
          const input = document.createElement('input');
          input.value = studentUrl;
          document.body.appendChild(input);
          input.select();
          document.execCommand('copy');
          input.remove();
          ui.showToast('학생 접속 주소가 복사되었습니다!', 'success');
        }
      });
    }
  }

  /* ------------------------------------------
     TEACHER EVENTS
     ------------------------------------------ */

  function bindTeacherEvents() {
    // Compare View Button click
    document.getElementById('btn-compare-view')?.addEventListener('click', () => {
      ui.openComparisonOverlay();
    });

    // Close Compare View click
    document.getElementById('btn-comparison-close')?.addEventListener('click', () => {
      ui.closeComparisonOverlay();
    });

    // 링크 보내기 버튼
    document.getElementById('btn-send-link')?.addEventListener('click', () => {
      openLinkModal();
    });

    document.getElementById('btn-link-modal-close')?.addEventListener('click', () => {
      closeLinkModal();
    });

    document.getElementById('btn-link-send')?.addEventListener('click', () => {
      sendLinkToStudents();
    });

    document.getElementById('input-link-url')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') sendLinkToStudents();
      if (e.key === 'Escape') closeLinkModal();
    });

    // Leave button
    document.getElementById('btn-leave')?.addEventListener('click', () => {
      if (confirm('수업을 종료하시겠습니까? 모든 학생의 연결이 끊어집니다.')) {
        leaveClass();
      }
    });

    // Spotlight close
    document.getElementById('btn-spotlight-close')?.addEventListener('click', () => {
      ui.closeSpotlight();
    });

    // Spotlight snapshot
    document.getElementById('btn-spotlight-snapshot')?.addEventListener('click', () => {
      if (ui.spotlightPeerId) {
        const info = peerManager.students.get(ui.spotlightPeerId);
        const name = info?.name || 'student';
        Tools.captureScreenshot(ui.spotlightVideo, name);
        ui.showToast('스냅샷이 저장되었습니다!', 'success');
      }
    });

    // ESC key to close overlays
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (ui.spotlightPeerId) {
          ui.closeSpotlight();
        }
        if (ui.comparisonOverlay && ui.comparisonOverlay.classList.contains('active')) {
          ui.closeComparisonOverlay();
        }
        closeLinkModal();
      }
    });
  }

  /* ------------------------------------------
     LINK SEND MODAL
     ------------------------------------------ */

  const LINK_STORAGE_KEY = 'parkshare-link-presets';

  function openLinkModal() {
    const modal = document.getElementById('link-modal');
    if (!modal) return;
    modal.style.display = 'flex';
    renderLinkPresets();
    const input = document.getElementById('input-link-url');
    if (input) {
      input.value = '';
      setTimeout(() => input.focus(), 100);
    }
  }

  function closeLinkModal() {
    const modal = document.getElementById('link-modal');
    if (modal) modal.style.display = 'none';
  }

  function sendLinkToStudents() {
    const input = document.getElementById('input-link-url');
    if (!input) return;

    let url = input.value.trim();
    if (!url) {
      ui.showToast('주소를 입력해 주세요.', 'warning');
      return;
    }

    // http:// 없으면 자동 을붙임
    if (!/^https?:\/\//.test(url)) {
      url = 'https://' + url;
    }

    const count = peerManager.students.size;
    if (count === 0) {
      ui.showToast('접속된 학생이 없습니다.', 'warning');
      return;
    }

    peerManager.broadcastCommand({ type: 'open-link', data: { url } });
    ui.showToast(`학생 ${count}명에게 링크를 전송했습니다!`, 'success');

    // Preset 저장
    saveLinkPreset(url);
    closeLinkModal();
  }

  function saveLinkPreset(url) {
    const raw = localStorage.getItem(LINK_STORAGE_KEY);
    let presets = raw ? JSON.parse(raw) : [];
    // 중복 제거 + 앞에 추가
    presets = [url, ...presets.filter(p => p !== url)].slice(0, 8);
    localStorage.setItem(LINK_STORAGE_KEY, JSON.stringify(presets));
  }

  function renderLinkPresets() {
    const listEl = document.getElementById('link-preset-list');
    if (!listEl) return;
    const raw = localStorage.getItem(LINK_STORAGE_KEY);
    const presets = raw ? JSON.parse(raw) : [];

    if (presets.length === 0) {
      listEl.innerHTML = '<span style="font-size:0.78rem; color:var(--text-muted)">전송 내역이 없습니다.</span>';
      return;
    }

    listEl.innerHTML = presets.map(url => {
      const short = url.replace(/^https?:\/\//, '').slice(0, 40) + (url.length > 48 ? '...' : '');
      return `<button class="preset-chip" data-url="${url}" title="${url}">${short}</button>`;
    }).join('');

    listEl.querySelectorAll('.preset-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        const input = document.getElementById('input-link-url');
        if (input) input.value = btn.dataset.url;
      });
    });
  }

  /* ------------------------------------------
     PEER CALLBACKS
     ------------------------------------------ */

  function setupPeerCallbacks() {
    peerManager.onStudentJoined = (peerId, name) => {
      console.log(`[TeacherApp] Student joined: ${name} (${peerId})`);
      ui.addStudentCard(peerId, name);
      ui.showToast(`${name} 학생이 접속했습니다`, 'success');
    };

    peerManager.onStudentLeft = (peerId) => {
      const info = peerManager.students.get(peerId);
      const name = info?.name || '학생';
      console.log(`[TeacherApp] Student left: ${name}`);
      ui.removeStudentCard(peerId);
      ui.showToast(`${name} 학생이 퇴장했습니다`, 'info');
    };

    peerManager.onStreamReceived = (peerId, stream) => {
      console.log(`[TeacherApp] Stream received from: ${peerId}`);
      ui.setCardStream(peerId, stream);
    };

    peerManager.onStreamEnded = (peerId) => {
      console.log(`[TeacherApp] Stream ended from: ${peerId}`);
      ui.setCardStream(peerId, null);
    };

    peerManager.onConnectionStatusChanged = (status) => {
      const statusMap = {
        connecting: { text: '연결 중...', dot: 'connecting' },
        connected: { text: '연결됨', dot: 'connected' },
        disconnected: { text: '연결 끊김', dot: 'error' }
      };

      const s = statusMap[status] || statusMap.disconnected;
      ui.updateLobbyStatus(s.dot, s.text);
    };

    peerManager.onError = (message) => {
      ui.showToast(message, 'error', 5000);
    };
  }

  /* ------------------------------------------
     UI CALLBACKS
     ------------------------------------------ */

  function setupUICallbacks() {
    // Selection changed -> update button state and badge count
    ui.onSelectionChanged = (count) => {
      const compareBtn = document.getElementById('btn-compare-view');
      if (compareBtn) {
        compareBtn.disabled = count === 0;
        compareBtn.querySelector('.btn-text').textContent = `선택 화면 보기 (${count})`;
      }
    };

    // Card click → spotlight
    ui.onCardClick = (peerId) => {
      const info = peerManager.students.get(peerId);
      if (info) {
        ui.openSpotlight(peerId, info.name || '학생', info.stream);
      }
    };

    // Snapshot
    ui.onSnapshot = (peerId, videoEl) => {
      const info = peerManager.students.get(peerId);
      const name = info?.name || 'student';
      Tools.captureScreenshot(videoEl, name);
      ui.showToast('스냅샷이 저장되었습니다!', 'success');
    };

    // Kick
    ui.onKick = (peerId) => {
      const info = peerManager.students.get(peerId);
      const name = info?.name || '학생';
      if (confirm(`${name} 학생을 내보내시겠습니까?`)) {
        peerManager.kickStudent(peerId);
        ui.showToast(`${name} 학생을 내보냈습니다`, 'info');
      }
    };
  }

  /* ------------------------------------------
     LEAVE CLASS
     ------------------------------------------ */

  function leaveClass() {
    peerManager.destroy();
    tools.destroy();
    ui.destroy();

    state.classroomKey = null;
    state.isLocked = false;

    // 페이지를 새로고침하여 초기 상태로 연결을 재시작합니다
    window.location.reload();
  }

  /* ------------------------------------------
     BEFORE UNLOAD
     ------------------------------------------ */

  window.addEventListener('beforeunload', () => {
    if (state.classroomKey) {
      peerManager.destroy();
    }
  });

  // pagehide is more reliable than beforeunload on some browsers (Safari, mobile)
  window.addEventListener('pagehide', () => {
    if (state.classroomKey) {
      peerManager.destroy();
    }
  });

  /* ------------------------------------------
     START
     ------------------------------------------ */

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
