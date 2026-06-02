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

    // Reconnection
    this._reconnectTimer = null;
    this._reconnectAttempts = 0;
    this._maxReconnectAttempts = 10;
    this._destroyed = false;
  }

  /* ------------------------------------------
     INITIALIZATION
     ------------------------------------------ */

  /**
   * 선생님으로 방 생성
   * 이전 세션이 PeerJS 서버에 남아있을 경우 자동으로 재시도
   */
  async createRoom(name) {
    this.role = 'teacher';
    this.myName = name;
    this.roomCode = this._getClassroomKey();
    this._maxReconnectAttempts = 999; // 교사 시그널링 서버 연결 무제한 재시도

    const peerId = `ps-${this.roomCode}-t`;
    const maxRetries = 10;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        await this._initPeer(peerId);
        break; // 성공
      } catch (err) {
        // 이전 세션 ID가 아직 서버에 남아있는 경우 → 자동 재시도
        if (err.type === 'unavailable-id' && attempt < maxRetries - 1) {
          console.log(`[PeerManager] 이전 세션 정리 대기 중... (${attempt + 1}/${maxRetries})`);
          this._notifyStatus('connecting');
          if (this.onError) {
            this.onError('이전 세션 정리 중... 잠시만 기다려 주세요.');
          }
          // 깨진 Peer 인스턴스 정리
          if (this.peer) {
            try { this.peer.destroy(); } catch {}
            this.peer = null;
          }
          await new Promise(r => setTimeout(r, 3000));
          continue;
        }
        throw err; // 다른 에러이거나 재시도 소진
      }
    }

    this._setupTeacherListeners();
    return this.roomCode;
  }

  /**
   * 학생으로 방 참가
   */
  async joinRoom(name, roomCode) {
    this.role = 'student';
    this.myName = name;
    this.roomCode = this._getClassroomKey();
    this._maxReconnectAttempts = 999; // 학생도 무제한 재연결 시도

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
          // Teacher ID already taken — createRoom에서 재시도 처리하므로 여기서는 reject만 함
          reject(err);
          return;
        }

        if (err.type === 'peer-unavailable') {
          if (this.role === 'student') {
            console.warn('[PeerManager] Teacher is offline. Scheduling reconnect...');
            this._notifyStatus('disconnected');
            
            // Clean up any failed/half-open connections
            if (this.teacherDataConn) {
              try { this.teacherDataConn.close(); } catch {}
              this.teacherDataConn = null;
            }
            if (this.teacherMediaConn) {
              try { this.teacherMediaConn.close(); } catch {}
              this.teacherMediaConn = null;
            }
            
            this._scheduleTeacherReconnect();
          } else {
            this._notifyError('대상 피어를 찾을 수 없습니다.');
          }
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
     TEACHER LOGIC
     ------------------------------------------ */

  _setupTeacherListeners() {
    // Data channel connections from students
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
          // Student joined
          const studentInfo = this.students.get(dataConn.peer) || {};
          studentInfo.name = msg.data.name;
          studentInfo.dataConn = dataConn;
          this.students.set(dataConn.peer, studentInfo);

          if (this.onStudentJoined) {
            this.onStudentJoined(dataConn.peer, msg.data.name);
          }
        } else if (msg.type === 'sharing') {
          // Student sharing status update
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

    // Media connections from students
    this.peer.on('call', (mediaConn) => {
      console.log('[Teacher] Incoming call from:', mediaConn.peer);

      // Answer without sending a stream back
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

        // Handle stream end
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
      if (info.dataConn) {
        try { info.dataConn.close(); } catch {}
      }
      if (info.mediaConn) {
        try { info.mediaConn.close(); } catch {}
      }
      if (info.stream) {
        info.stream.getTracks().forEach(t => t.stop());
      }
      this.students.delete(peerId);
    }
    if (this.onStudentLeft) {
      this.onStudentLeft(peerId);
    }
  }

  /**
   * 선생님 → 특정 학생에게 명령 전송
   */
  sendCommandToStudent(peerId, command) {
    const info = this.students.get(peerId);
    if (info && info.dataConn && info.dataConn.open) {
      info.dataConn.send(JSON.stringify(command));
    }
  }

  /**
   * 선생님 → 모든 학생에게 명령 전송
   */
  broadcastCommand(command) {
    const msg = JSON.stringify(command);
    for (const [peerId, info] of this.students) {
      if (info.dataConn && info.dataConn.open) {
        info.dataConn.send(msg);
      }
    }
  }

  /**
   * 특정 학생 연결 해제
   */
  kickStudent(peerId) {
    this.sendCommandToStudent(peerId, { type: 'kick', data: {} });
    setTimeout(() => this._removeStudent(peerId), 500);
  }

  /**
   * 연결된 학생 이름 목록
   */
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

  _connectToTeacher() {
    this._notifyStatus('connecting');
    const teacherPeerId = `ps-${this.roomCode}-t`;

    // Data connection
    this.teacherDataConn = this.peer.connect(teacherPeerId, {
      reliable: true
    });

    this.teacherDataConn.on('open', () => {
      console.log('[Student] Connected to teacher');
      this._notifyStatus('connected');
      this._reconnectAttempts = 0; // 재연결 성공 시 카운터 초기화

      // Send join message
      this.teacherDataConn.send(JSON.stringify({
        type: 'join',
        data: { name: this.myName }
      }));

      // 이전 접속 여부 확인 → 교사 재접속 후 재연결된 경우 콜백
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

      console.log('[Student] Received command:', msg.type);

      if (this.onCommandReceived) {
        this.onCommandReceived(msg);
      }

      if (msg.type === 'kick') {
        this.destroy();
      }
    });

    this.teacherDataConn.on('close', () => {
      console.log('[Student] Disconnected from teacher, will retry...');
      this._notifyStatus('disconnected');

      if (this.teacherMediaConn) {
        try { this.teacherMediaConn.close(); } catch {}
        this.teacherMediaConn = null;
      }

      if (!this._destroyed) {
        // 교사 재접속을 기다리며 지속 재시도 (포기하지 않음)
        this._reconnectAttempts = 0; // 포기하지 않도록 카운터 초기화
        this._maxReconnectAttempts = 999; // 사실상 무한 재시도
        this._scheduleTeacherReconnect();
      }
    });

    this.teacherDataConn.on('error', (err) => {
      console.error('[Student] Data connection error:', err);
    });
  }

  /**
   * 교사 재연결 대기 루프 (1초, 2초, 4초... 최대 8초 간격)
   */
  _scheduleTeacherReconnect() {
    if (this._destroyed || this._reconnectTimer) return;

    const delay = Math.min(1000 * Math.pow(2, Math.min(this._reconnectAttempts, 3)), 8000);
    this._reconnectAttempts++;
    console.log(`[Student] Waiting ${delay}ms before retrying teacher connection...`);

    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      if (this._destroyed) return;

      if (this.peer && !this.peer.destroyed && !this.peer.disconnected) {
        // Peer 자체는 살아있고 시그널링 서버에도 연결되어 있으면 바로 재연결 시도
        this._connectToTeacher();
      } else {
        // Peer가 죽었거나 시그널링 서버와 끊겼으면 전체 재초기화
        this._reinitialize();
      }
    }, delay);
  }

  async startScreenShare() {
    // 1. Secure context (HTTPS/localhost) and API existence validation
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
      const isSecure = window.isSecureContext;
      if (!isSecure) {
        this._notifyError('보안 연결(HTTPS)이 필요합니다! 화면 공유 API는 안전한 연결(HTTPS)이나 localhost 주소에서만 작동합니다. 브라우저 주소창의 http://를 https://로 변경하여 접속해 주세요.');
      } else {
        this._notifyError('사용 중인 브라우저가 화면 공유 API(getDisplayMedia)를 지원하지 않습니다.');
      }
      throw new Error('API_NOT_SUPPORTED');
    }

    try {
      // Check if existing localStream is active
      let isStreamActive = false;
      if (this.localStream) {
        const videoTrack = this.localStream.getVideoTracks()[0];
        if (videoTrack && videoTrack.readyState === 'live') {
          isStreamActive = true;
        }
      }

      if (isStreamActive) {
        console.log('[PeerManager] Reusing existing active localStream');
      } else {
        // 2. Simplified & universally compatible screen sharing constraints
        this.localStream = await navigator.mediaDevices.getDisplayMedia({
          video: {
            displaySurface: 'monitor', // Nudge entire screen
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 15, max: 30 }
          },
          audio: false
        });

        // 3. Strict validation: Verify if the shared surface is the entire screen ('monitor' or 'screen')
        const videoTrack = this.localStream.getVideoTracks()[0];
        if (videoTrack) {
          const settings = videoTrack.getSettings();
          console.log('[PeerManager] Video track settings:', settings);
          
          // If displaySurface is available and is NOT 'monitor' or 'screen', reject it.
          const isMonitor = settings.displaySurface === 'monitor' || settings.displaySurface === 'screen';
          if (settings && settings.displaySurface && !isMonitor) {
            // Immediately stop all tracks to release resource
            this.localStream.getTracks().forEach(track => track.stop());
            this.localStream = null;
            
            const err = new Error('NOT_MONITOR');
            throw err;
          }
        }
      }

      const teacherPeerId = `ps-${this.roomCode}-t`;
      
      // Close previous media connection if any
      if (this.teacherMediaConn) {
        try { this.teacherMediaConn.close(); } catch {}
      }
      
      this.teacherMediaConn = this.peer.call(teacherPeerId, this.localStream);

      // Notify teacher about sharing status
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
        // Already handled above
      } else if (err.message === 'NOT_MONITOR') {
        this._notifyError('보안 및 수업 관리를 위해 반드시 \'전체 화면\'을 공유해 주세요! (창이나 탭 공유는 허용되지 않습니다.)');
      } else if (err.name === 'NotAllowedError') {
        this._notifyError('화면 공유 권한이 거부되었습니다.');
      } else {
        this._notifyError('화면 공유를 시작할 수 없습니다. 브라우저 설정이나 HTTPS 보안 연결을 확인해 주세요.');
      }
      throw err;
    }
  }

  /**
   * 학생: 화면 공유 중지
   */
  stopScreenShare() {
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => track.stop());
      this.localStream = null;
    }
    if (this.teacherMediaConn) {
      try { this.teacherMediaConn.close(); } catch {}
      this.teacherMediaConn = null;
    }

    // Notify teacher
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
        // Re-init from scratch
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

  /**
   * 연결 종료 및 정리
   */
  destroy() {
    this._destroyed = true;

    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }

    // Clean up student connections (teacher)
    for (const [peerId, info] of this.students) {
      if (info.dataConn) try { info.dataConn.close(); } catch {}
      if (info.mediaConn) try { info.mediaConn.close(); } catch {}
      if (info.stream) info.stream.getTracks().forEach(t => t.stop());
    }
    this.students.clear();

    // Clean up teacher connection (student)
    if (this.localStream) {
      this.localStream.getTracks().forEach(t => t.stop());
      this.localStream = null;
    }
    if (this.teacherDataConn) try { this.teacherDataConn.close(); } catch {}
    if (this.teacherMediaConn) try { this.teacherMediaConn.close(); } catch {}

    // Destroy peer
    if (this.peer) {
      try { this.peer.destroy(); } catch {}
      this.peer = null;
    }
  }
}

// Export globally
window.PeerManager = PeerManager;
