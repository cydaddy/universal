/* ============================================
   PeerManager - WebRTC 연결 관리
   PeerJS를 활용한 시그널링 및 스트림 관리
   ============================================ */

class PeerManager {
  constructor() {
    this.peer = null;
    this.role = null;       // 'teacher' | 'student'
    this.roomCode = null;
    this.myName = null;

    // Teacher: 학생 정보 관리
    this.students = new Map(); // peerId → { name, dataConn, mediaConn, stream }

    // Student: 선생님 연결
    this.teacherDataConn = null;
    this.teacherMediaConn = null;
    this.localStream = null;

    // Callbacks
    this.onStudentJoined = null;        // (peerId, name) => {}
    this.onStudentLeft = null;          // (peerId) => {}
    this.onStreamReceived = null;       // (peerId, stream) => {}
    this.onStreamEnded = null;          // (peerId) => {}
    this.onCommandReceived = null;      // (command) => {}
    this.onConnectionStatusChanged = null; // (status) => {}
    this.onError = null;                // (error) => {}
    this.onTeacherReconnected = null;   // () => {} - 교사가 재접속할 때 학생에게 알림

    // Heartbeat
    this._heartbeatInterval = null;
    this._heartbeatTimeout = null;

    // Reconnection
    this._reconnectTimer = null;
    this._reconnectAttempts = 0;
    this._maxReconnectAttempts = 999;
    this._destroyed = false;
  }

  /* ------------------------------------------
     INITIALIZATION
     ------------------------------------------ */

  /**
   * 선생님으로 방 생성
   * 고정 ID (ps-{room}-t) 사용. unavailable-id 시 반복 재시도.
   */
  async createRoom(name) {
    this.role = 'teacher';
    this.myName = name;
    this.roomCode = this._getClassroomKey();

    const peerId = `ps-${this.roomCode}-t`;
    const maxRetries = 20; // 20회 × 3초 = 최대 60초

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        await this._initPeer(peerId);
        break; // 성공
      } catch (err) {
        if (err.type === 'unavailable-id' && attempt < maxRetries - 1) {
          console.log(`[PeerManager] 이전 세션 정리 대기 중... (${attempt + 1}/${maxRetries})`);
          this._notifyStatus('connecting');
          if (this.onError) {
            this.onError(`이전 세션 정리 중... (${attempt + 1}/${maxRetries})`);
          }
          if (this.peer) {
            try { this.peer.destroy(); } catch {}
            this.peer = null;
          }
          await new Promise(r => setTimeout(r, 3000));
          continue;
        }
        throw err;
      }
    }

    this._setupTeacherListeners();
    this._startTeacherHeartbeat();
    return this.roomCode;
  }

  /**
   * 학생으로 방 참가
   */
  async joinRoom(name) {
    this.role = 'student';
    this.myName = name;
    this.roomCode = this._getClassroomKey();

    const peerId = `ps-${this.roomCode}-s-${this._randomId()}`;
    await this._initPeer(peerId);
    this._connectToTeacher();
  }

  /**
   * PeerJS 인스턴스 초기화
   */
  _initPeer(peerId) {
    return new Promise((resolve, reject) => {
      this._notifyStatus('connecting');

      this.peer = new Peer(peerId, {
        config: {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun2.l.google.com:19302' },
          ]
        },
        debug: 0
      });

      this.peer.on('open', (id) => {
        console.log('[PeerManager] Connected as:', id);
        this._notifyStatus('connected');
        this._reconnectAttempts = 0;
        resolve(id);
      });

      this.peer.on('error', (err) => {
        console.error('[PeerManager] Error:', err.type, err.message);

        if (err.type === 'unavailable-id') {
          reject(err);
          return;
        }

        // peer-unavailable: 교사가 아직 없음 — 학생 재연결 루프에서 처리
        if (err.type === 'peer-unavailable') {
          console.warn('[PeerManager] peer-unavailable — teacher not online yet');
          // 아무것도 안 함 — _connectToTeacher의 타임아웃이 처리
          return;
        }

        if (err.type === 'network' || err.type === 'server-error' || err.type === 'socket-error') {
          this._notifyStatus('disconnected');
          this._attemptReconnect();
          return;
        }

        this._notifyError(err.message || '연결 오류가 발생했습니다.');
      });

      this.peer.on('disconnected', () => {
        console.log('[PeerManager] Disconnected from signaling server');
        if (!this._destroyed) {
          this._notifyStatus('disconnected');
          this._attemptReconnect();
        }
      });

      this.peer.on('close', () => {
        console.log('[PeerManager] Peer closed');
        this._notifyStatus('disconnected');
      });
    });
  }

  /* ------------------------------------------
     HEARTBEAT (교사 → 학생 주기적 ping)
     ------------------------------------------ */

  _startTeacherHeartbeat() {
    this._stopHeartbeat();
    this._heartbeatInterval = setInterval(() => {
      this.broadcastCommand({ type: 'ping' });
    }, 3000);
  }

  _startStudentHeartbeatChecker() {
    this._stopHeartbeat();
    this._resetHeartbeatTimeout();
  }

  _resetHeartbeatTimeout() {
    if (this._heartbeatTimeout) clearTimeout(this._heartbeatTimeout);
    this._heartbeatTimeout = setTimeout(() => {
      if (this._destroyed) return;
      console.warn('[Student] ❌ Teacher heartbeat lost! Starting reconnection...');
      this._stopHeartbeat();

      // 교사가 떠난 것으로 판단 → 기존 연결 정리 후 재연결 루프 시작
      if (this.teacherDataConn) {
        try { this.teacherDataConn.close(); } catch {}
        this.teacherDataConn = null;
      }
      if (this.teacherMediaConn) {
        try { this.teacherMediaConn.close(); } catch {}
        this.teacherMediaConn = null;
      }
      this._notifyStatus('disconnected');
      this._reconnectAttempts = 0;
      this._scheduleTeacherReconnect();
    }, 12000);
  }

  _stopHeartbeat() {
    if (this._heartbeatInterval) {
      clearInterval(this._heartbeatInterval);
      this._heartbeatInterval = null;
    }
    if (this._heartbeatTimeout) {
      clearTimeout(this._heartbeatTimeout);
      this._heartbeatTimeout = null;
    }
  }

  /* ------------------------------------------
     TEACHER LOGIC
     ------------------------------------------ */

  _setupTeacherListeners() {
    this.peer.on('connection', (dataConn) => {
      console.log('[Teacher] Data connection from:', dataConn.peer);

      dataConn.on('open', () => {
        console.log('[Teacher] Data channel open:', dataConn.peer);
      });

      dataConn.on('data', (rawData) => {
        let msg;
        try {
          msg = typeof rawData === 'string' ? JSON.parse(rawData) : rawData;
        } catch {
          return;
        }

        if (msg.type === 'join') {
          const studentInfo = this.students.get(dataConn.peer) || {};
          studentInfo.name = msg.data.name;
          studentInfo.dataConn = dataConn;
          this.students.set(dataConn.peer, studentInfo);

          if (this.onStudentJoined) {
            this.onStudentJoined(dataConn.peer, msg.data.name);
          }
        } else if (msg.type === 'sharing') {
          const info = this.students.get(dataConn.peer);
          if (info) {
            info.isSharing = msg.data.active;
          }
        }
      });

      dataConn.on('close', () => {
        console.log('[Teacher] Student disconnected:', dataConn.peer);
        this._removeStudent(dataConn.peer);
      });

      dataConn.on('error', (err) => {
        console.error('[Teacher] Data connection error:', err);
      });
    });

    this.peer.on('call', (mediaConn) => {
      console.log('[Teacher] Incoming call from:', mediaConn.peer);
      mediaConn.answer();

      mediaConn.on('stream', (stream) => {
        console.log('[Teacher] Received stream from:', mediaConn.peer);

        const studentInfo = this.students.get(mediaConn.peer) || {};
        studentInfo.mediaConn = mediaConn;
        studentInfo.stream = stream;
        studentInfo.isSharing = true;
        this.students.set(mediaConn.peer, studentInfo);

        if (this.onStreamReceived) {
          this.onStreamReceived(mediaConn.peer, stream);
        }

        stream.getTracks().forEach(track => {
          track.onended = () => {
            console.log('[Teacher] Stream track ended from:', mediaConn.peer);
            const info = this.students.get(mediaConn.peer);
            if (info) {
              info.stream = null;
              info.isSharing = false;
            }
            if (this.onStreamEnded) {
              this.onStreamEnded(mediaConn.peer);
            }
          };
        });
      });

      mediaConn.on('close', () => {
        console.log('[Teacher] Media connection closed:', mediaConn.peer);
        const info = this.students.get(mediaConn.peer);
        if (info) {
          info.stream = null;
          info.isSharing = false;
          info.mediaConn = null;
        }
        if (this.onStreamEnded) {
          this.onStreamEnded(mediaConn.peer);
        }
      });
    });
  }

  _removeStudent(peerId) {
    const info = this.students.get(peerId);
    if (info) {
      if (info.dataConn) { try { info.dataConn.close(); } catch {} }
      if (info.mediaConn) { try { info.mediaConn.close(); } catch {} }
      if (info.stream) { info.stream.getTracks().forEach(t => t.stop()); }
      this.students.delete(peerId);
    }
    if (this.onStudentLeft) {
      this.onStudentLeft(peerId);
    }
  }

  sendCommandToStudent(peerId, command) {
    const info = this.students.get(peerId);
    if (info && info.dataConn && info.dataConn.open) {
      info.dataConn.send(JSON.stringify(command));
    }
  }

  broadcastCommand(command) {
    const msg = JSON.stringify(command);
    for (const [peerId, info] of this.students) {
      if (info.dataConn && info.dataConn.open) {
        info.dataConn.send(msg);
      }
    }
  }

  kickStudent(peerId) {
    this.sendCommandToStudent(peerId, { type: 'kick', data: {} });
    setTimeout(() => this._removeStudent(peerId), 500);
  }

  getStudentNames() {
    const names = [];
    for (const [peerId, info] of this.students) {
      if (info.name) {
        names.push({ peerId, name: info.name });
      }
    }
    return names;
  }

  /* ------------------------------------------
     STUDENT LOGIC
     ------------------------------------------ */

  /**
   * 교사에게 연결 (고정 ID: ps-{room}-t)
   */
  _connectToTeacher() {
    if (this._destroyed) return;

    // 기존 연결 정리
    if (this.teacherDataConn) {
      try { this.teacherDataConn.close(); } catch {}
      this.teacherDataConn = null;
    }

    this._notifyStatus('connecting');
    const teacherPeerId = `ps-${this.roomCode}-t`;
    console.log(`[Student] Connecting to teacher: ${teacherPeerId}`);

    this.teacherDataConn = this.peer.connect(teacherPeerId, {
      reliable: true
    });

    // 5초 타임아웃: open 안 되면 재시도
    const connectTimeout = setTimeout(() => {
      console.log('[Student] Connection attempt timed out');
      if (this.teacherDataConn) {
        try { this.teacherDataConn.close(); } catch {}
        this.teacherDataConn = null;
      }
      this._scheduleTeacherReconnect();
    }, 5000);

    this.teacherDataConn.on('open', () => {
      clearTimeout(connectTimeout);
      console.log('[Student] ✅ Connected to teacher!');
      this._notifyStatus('connected');
      this._reconnectAttempts = 0;

      // Send join message
      this.teacherDataConn.send(JSON.stringify({
        type: 'join',
        data: { name: this.myName }
      }));

      // 하트비트 체커 시작
      this._startStudentHeartbeatChecker();

      // 이전 접속 여부 → 교사 재접속 후 재연결된 경우 콜백
      if (this._wasConnected) {
        console.log('[Student] Teacher reconnected! Triggering re-share...');
        if (this.onTeacherReconnected) {
          this.onTeacherReconnected();
        }
      }
      this._wasConnected = true;
    });

    this.teacherDataConn.on('data', (rawData) => {
      let msg;
      try {
        msg = typeof rawData === 'string' ? JSON.parse(rawData) : rawData;
      } catch {
        return;
      }

      // 하트비트는 UI로 전달하지 않음
      if (msg.type === 'ping') {
        this._resetHeartbeatTimeout();
        return;
      }

      console.log('[Student] Received command:', msg.type);

      if (this.onCommandReceived) {
        this.onCommandReceived(msg);
      }

      if (msg.type === 'kick') {
        this.destroy();
      }
    });

    this.teacherDataConn.on('close', () => {
      clearTimeout(connectTimeout);
      console.log('[Student] Data connection closed');
      this._stopHeartbeat();
      this._notifyStatus('disconnected');

      if (this.teacherMediaConn) {
        try { this.teacherMediaConn.close(); } catch {}
        this.teacherMediaConn = null;
      }

      if (!this._destroyed) {
        this._reconnectAttempts = 0;
        this._scheduleTeacherReconnect();
      }
    });

    this.teacherDataConn.on('error', (err) => {
      clearTimeout(connectTimeout);
      console.error('[Student] Data connection error:', err);
    });
  }

  /**
   * 교사 재연결 대기 루프 (2초, 3초, 4.5초... 최대 8초 간격)
   */
  _scheduleTeacherReconnect() {
    if (this._destroyed || this._reconnectTimer) return;

    const delay = Math.min(2000 * Math.pow(1.5, Math.min(this._reconnectAttempts, 4)), 8000);
    this._reconnectAttempts++;
    console.log(`[Student] Retrying teacher connection in ${Math.round(delay)}ms (attempt ${this._reconnectAttempts})`);

    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      if (this._destroyed) return;

      if (this.peer && !this.peer.destroyed && !this.peer.disconnected) {
        this._connectToTeacher();
      } else {
        this._reinitialize();
      }
    }, delay);
  }

  async startScreenShare() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
      const isSecure = window.isSecureContext;
      if (!isSecure) {
        this._notifyError('보안 연결(HTTPS)이 필요합니다! 화면 공유 API는 안전한 연결(HTTPS)이나 localhost 주소에서만 작동합니다.');
      } else {
        this._notifyError('사용 중인 브라우저가 화면 공유 API(getDisplayMedia)를 지원하지 않습니다.');
      }
      throw new Error('API_NOT_SUPPORTED');
    }

    try {
      // 기존 활성 스트림이 있으면 재사용
      let isStreamActive = false;
      if (this.localStream) {
        const vt = this.localStream.getVideoTracks()[0];
        if (vt && vt.readyState === 'live') {
          isStreamActive = true;
        }
      }

      if (isStreamActive) {
        console.log('[PeerManager] Reusing existing active localStream');
      } else {
        this.localStream = await navigator.mediaDevices.getDisplayMedia({
          video: {
            displaySurface: 'monitor',
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 15, max: 30 }
          },
          audio: false
        });

        // 전체 화면 검증
        const videoTrack = this.localStream.getVideoTracks()[0];
        if (videoTrack) {
          const settings = videoTrack.getSettings();
          console.log('[PeerManager] Video track settings:', settings);
          const isMonitor = settings.displaySurface === 'monitor' || settings.displaySurface === 'screen';
          if (settings && settings.displaySurface && !isMonitor) {
            this.localStream.getTracks().forEach(track => track.stop());
            this.localStream = null;
            throw new Error('NOT_MONITOR');
          }
        }
      }

      // 교사에게 미디어 전송
      const teacherPeerId = `ps-${this.roomCode}-t`;

      if (this.teacherMediaConn) {
        try { this.teacherMediaConn.close(); } catch {}
      }

      this.teacherMediaConn = this.peer.call(teacherPeerId, this.localStream);

      if (this.teacherDataConn && this.teacherDataConn.open) {
        this.teacherDataConn.send(JSON.stringify({
          type: 'sharing',
          data: { active: true }
        }));
      }

      return this.localStream;
    } catch (err) {
      console.error('[Student] Failed to share screen:', err);
      if (err.message === 'API_NOT_SUPPORTED') {
        // Already handled
      } else if (err.message === 'NOT_MONITOR') {
        this._notifyError('반드시 \'전체 화면\'을 공유해 주세요! (창이나 탭 공유는 허용되지 않습니다.)');
      } else if (err.name === 'NotAllowedError') {
        this._notifyError('화면 공유 권한이 거부되었습니다.');
      } else {
        this._notifyError('화면 공유를 시작할 수 없습니다.');
      }
      throw err;
    }
  }

  stopScreenShare() {
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => track.stop());
      this.localStream = null;
    }
    if (this.teacherMediaConn) {
      try { this.teacherMediaConn.close(); } catch {}
      this.teacherMediaConn = null;
    }
    if (this.teacherDataConn && this.teacherDataConn.open) {
      this.teacherDataConn.send(JSON.stringify({
        type: 'sharing',
        data: { active: false }
      }));
    }
  }

  /* ------------------------------------------
     RECONNECTION
     ------------------------------------------ */

  _attemptReconnect() {
    if (this._destroyed || this._reconnectTimer) return;

    this._reconnectAttempts++;
    if (this._reconnectAttempts > this._maxReconnectAttempts) {
      this._notifyError('연결 재시도 한도를 초과했습니다. 페이지를 새로고침해주세요.');
      return;
    }

    const delay = Math.min(1000 * Math.pow(2, this._reconnectAttempts - 1), 10000);
    console.log(`[PeerManager] Reconnecting in ${delay}ms (attempt ${this._reconnectAttempts})`);
    this._notifyStatus('connecting');

    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      if (this.peer && !this.peer.destroyed) {
        this.peer.reconnect();
      } else {
        this._reinitialize();
      }
    }, delay);
  }

  async _reinitialize() {
    try {
      if (this.role === 'teacher') {
        const peerId = `ps-${this.roomCode}-t`;
        await this._initPeer(peerId);
        this._setupTeacherListeners();
        this._startTeacherHeartbeat();
      } else {
        const peerId = `ps-${this.roomCode}-s-${this._randomId()}`;
        await this._initPeer(peerId);
        this._connectToTeacher();
      }
    } catch (err) {
      console.error('[PeerManager] Reinitialize failed:', err);
      this._attemptReconnect();
    }
  }

  /* ------------------------------------------
     UTILITIES
     ------------------------------------------ */

  _getClassroomKey() {
    const host = window.location.hostname || 'local';
    return host.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
  }

  _randomId() {
    return Math.random().toString(36).substring(2, 7);
  }

  _notifyStatus(status) {
    if (this.onConnectionStatusChanged) {
      this.onConnectionStatusChanged(status);
    }
  }

  _notifyError(message) {
    if (this.onError) {
      this.onError(message);
    }
  }

  destroy() {
    this._destroyed = true;
    this._stopHeartbeat();

    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }

    for (const [peerId, info] of this.students) {
      if (info.dataConn) try { info.dataConn.close(); } catch {}
      if (info.mediaConn) try { info.mediaConn.close(); } catch {}
      if (info.stream) info.stream.getTracks().forEach(t => t.stop());
    }
    this.students.clear();

    if (this.localStream) {
      this.localStream.getTracks().forEach(t => t.stop());
      this.localStream = null;
    }
    if (this.teacherDataConn) try { this.teacherDataConn.close(); } catch {}
    if (this.teacherMediaConn) try { this.teacherMediaConn.close(); } catch {}

    if (this.peer) {
      try { this.peer.destroy(); } catch {}
      this.peer = null;
    }
  }
}

window.PeerManager = PeerManager;
