/* ============================================
   StudentApp - 학생용 애플리케이션 컨트롤러
   학생 접속 제어 및 화면 공유 무한 재시도 로직
   ============================================ */

(function () {
  'use strict';

  // --- State ---
  const state = {
    role: 'student',
    name: null,
    isSharing: false,
  };

  // --- Modules ---
  const peerManager = new PeerManager();
  const tools = new Tools();
  const ui = new UI();

  /* ------------------------------------------
     INITIALIZATION
     ------------------------------------------ */

  function init() {
    bindLobbyEvents();
    bindStudentEvents();
    setupPeerCallbacks();

    // Restore last name from localStorage
    const savedName = localStorage.getItem('parkshare-name');
    if (savedName) {
      const nameInput = document.getElementById('input-name');
      if (nameInput) {
        nameInput.value = savedName;
        validateLobby();
      }
    }

    console.log('[ParkShare] Student App initialized');
  }

  /* ------------------------------------------
     LOBBY
     ------------------------------------------ */

  function bindLobbyEvents() {
    const nameInput = document.getElementById('input-name');
    const joinBtn = document.getElementById('btn-join');

    if (nameInput) {
      nameInput.addEventListener('input', validateLobby);
      nameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') handleJoin();
      });
    }

    if (joinBtn) {
      joinBtn.addEventListener('click', handleJoin);
    }
  }

  function validateLobby() {
    const nameInput = document.getElementById('input-name');
    const joinBtn = document.getElementById('btn-join');
    if (!nameInput || !joinBtn) return;

    const nameValid = nameInput.value.trim().length > 0;
    joinBtn.disabled = !nameValid;

    const statusText = document.getElementById('lobby-status-text');
    if (statusText) {
      statusText.textContent = nameValid ? '참가할 준비가 되었습니다' : '이름을 입력해 주세요';
    }
  }

  async function handleJoin() {
    const nameInput = document.getElementById('input-name');
    const joinBtn = document.getElementById('btn-join');
    if (!nameInput || !joinBtn || joinBtn.disabled) return;

    const name = nameInput.value.trim();
    state.name = name;

    // Save name in local storage
    localStorage.setItem('parkshare-name', name);

    joinBtn.disabled = true;
    joinBtn.textContent = '연결 중...';
    ui.updateLobbyStatus('connecting', '선생님께 연결 중...');

    try {
      // 학생으로 연결 개시 (방 코드는 도메인 기반으로 자동 계산됨)
      await peerManager.joinRoom(name);
      
      ui.switchView('student-view');
      ui.showToast('교실에 접속되었습니다!', 'success');

      // 접속 직후 자동으로 화면 공유 프롬프트 띄우기
      setTimeout(() => autoStartSharing(), 800);
    } catch (err) {
      console.error('[StudentApp] Connect failed:', err);
      joinBtn.disabled = false;
      joinBtn.textContent = '수업 참가하기';
      ui.updateLobbyStatus('error', '연결 실패. 다시 시도해주세요.');
      ui.showToast('교실 연결에 실패했습니다. 선생님이 수업을 시작했는지 확인해 주세요.', 'error');
    }
  }

  /* ------------------------------------------
     STUDENT EVENTS
     ------------------------------------------ */

  function bindStudentEvents() {
    // Share screen button (수동 또는 재공유용)
    document.getElementById('btn-share-screen')?.addEventListener('click', async () => {
      if (state.isSharing) {
        stopSharing();
      } else {
        await startSharing();
      }
    });

    // Leave button
    document.getElementById('btn-student-leave')?.addEventListener('click', () => {
      if (confirm('교실에서 퇴장하시겠습니까? 화면 공유가 중지됩니다.')) {
        leaveRoom();
      }
    });
  }

  /**
   * 자동 화면 공유 시작
   */
  async function autoStartSharing() {
    try {
      await startSharing();
    } catch (err) {
      console.warn('[StudentApp] Auto share failed, user can retry manually:', err);
      if (err.message === 'NOT_MONITOR') {
        ui.showToast('반드시 \'전체 화면\'을 선택하고 [공유]를 눌러야 합니다.', 'warning');
      } else {
        ui.showToast('화면 공유 버튼을 눌러 화면을 공유해 주세요.', 'info');
      }
    }
  }

  async function startSharing() {
    const shareBtn = document.getElementById('btn-share-screen');
    const statusText = document.getElementById('share-status-text');
    const preview = document.getElementById('student-preview');
    const previewVideo = document.getElementById('student-preview-video');

    try {
      const stream = await peerManager.startScreenShare();
      state.isSharing = true;

      // UI 업데이트
      if (shareBtn) {
        shareBtn.classList.add('sharing');
        shareBtn.querySelector('.share-icon').textContent = '⏹️';
        shareBtn.querySelector('span:last-child').textContent = '공유 중지';
      }
      if (statusText) statusText.textContent = '선생님과 내 전체 화면을 공유 중입니다.';

      // Preview 연결
      if (previewVideo) {
        previewVideo.srcObject = stream;
      }
      if (preview) {
        preview.classList.add('active');
      }

      // 화면 공유가 브라우저 제어판이나 외부 원인에 의해 중단될 때 처리 (재공유 강제)
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack && !videoTrack._hasEndedListener) {
        videoTrack._hasEndedListener = true;
        videoTrack.addEventListener('ended', () => {
          stopSharing();
          
          // 화면 공유 끄기 방지: 즉시 1초 후 자동 화면 공유 유도
          ui.showToast('수업 모니터링을 위해 전체 화면 공유를 다시 시작합니다...', 'info');
          setTimeout(() => autoStartSharing(), 1000);
        });
      }
    } catch (err) {
      console.error('[StudentApp] Share failed:', err);
      // 공유에 실패했거나 취소되었을 경우 UI 초기 상태 복구
      stopSharing();
      throw err;
    }
  }

  function stopSharing() {
    const shareBtn = document.getElementById('btn-share-screen');
    const statusText = document.getElementById('share-status-text');
    const preview = document.getElementById('student-preview');
    const previewVideo = document.getElementById('student-preview-video');

    peerManager.stopScreenShare();
    state.isSharing = false;

    // UI 복구
    if (shareBtn) {
      shareBtn.classList.remove('sharing');
      shareBtn.querySelector('.share-icon').textContent = '🖥️';
      shareBtn.querySelector('span:last-child').textContent = '화면 공유';
    }
    if (statusText) statusText.textContent = '아래 화면 공유 버튼을 눌러 공유를 시작해 주세요.';

    if (previewVideo) {
      previewVideo.srcObject = null;
    }
    if (preview) {
      preview.classList.remove('active');
    }
  }

  /* ------------------------------------------
     PEER CALLBACKS
     ------------------------------------------ */

  function setupPeerCallbacks() {
    peerManager.onCommandReceived = (command) => {
      handleTeacherCommand(command);
    };

    // 교사가 재접속했을 때 → 화면 공유 자동 재개
    peerManager.onTeacherReconnected = () => {
      console.log('[StudentApp] Teacher reconnected, resuming screen share...');
      ui.showToast('선생님이 재접속하셨습니다. 화면 공유를 재개합니다...', 'info');
      setTimeout(() => {
        startSharing().catch(err => {
          console.error('[StudentApp] Failed to resume screen share:', err);
        });
      }, 800);
    };

    peerManager.onConnectionStatusChanged = (status) => {
      const statusMap = {
        connecting: { text: '선생님께 연결 중...', dot: 'connecting' },
        connected: { text: '선생님과 연결됨', dot: 'connected' },
        disconnected: { text: '선생님 연결 끊김 - 재연결 대기 중...', dot: 'error' }
      };

      const s = statusMap[status] || statusMap.disconnected;
      ui.updateStudentStatus(s.dot, s.text);
      ui.updateLobbyStatus(s.dot, s.text);
    };

    peerManager.onError = (message) => {
      ui.showToast(message, 'error', 5000);
    };
  }

  /* ------------------------------------------
     TEACHER COMMAND HANDLING
     ------------------------------------------ */

  function handleTeacherCommand(command) {
    switch (command.type) {
      case 'kick':
        ui.showToast('선생님이 접속을 강제 종료시켰습니다.', 'warning');
        setTimeout(() => leaveRoom(), 1000);
        break;

      case 'open-link': {
        const url = command.data?.url;
        if (!url) break;
        console.log('[StudentApp] Opening link from teacher:', url);
        ui.showToast('선생님이 링크를 보냈습니다. 새 탭에서 열립니다...', 'info');
        setTimeout(() => {
          window.open(url, '_blank', 'noopener,noreferrer');
        }, 500);
        break;
      }
    }
  }

  /* ------------------------------------------
     LEAVE ROOM
     ------------------------------------------ */

  function leaveRoom() {
    peerManager.destroy();
    tools.destroy();
    ui.destroy();

    state.isSharing = false;

    // UI 복구
    ui.switchView('lobby-view');
    
    const joinBtn = document.getElementById('btn-join');
    if (joinBtn) {
      joinBtn.disabled = false;
      joinBtn.textContent = '수업 참가하기';
    }
    
    ui.updateLobbyStatus('', '이름을 입력해 주세요');

    // 화면 공유 UI 비활성화
    stopSharing();
  }

  /* ------------------------------------------
     BEFORE UNLOAD
     ------------------------------------------ */

  window.addEventListener('beforeunload', () => {
    if (state.name) {
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
