(function (root) {
  'use strict';

  class GuestNetwork {
    constructor({ socket, now = () => performance.now(), requestId, onChange = () => {} }) {
      this.socket = socket;
      this.now = now;
      this.requestId = requestId;
      this.onChange = onChange;
      this.connected = false;
      this.recovering = true;
      this.identityReady = false;
      this.fatal = false;
      this.snapshot = null;
      this.quiz = null;
      this.submission = null;
      this.offset = null;
      this.latestServerNow = -Infinity;
      this.snapshotTime = -Infinity;
      this.retiredRuns = new Set();
      this.seq = -1;
      this.taps = new Map();
      this.lastSync = -Infinity;
      this.needsQuizRecovery = true;
    }

    serverNow() { return this.now() + (this.offset ?? 0); }
    fresh() { return this.offset !== null && this.serverNow() - this.latestServerNow <= 3000; }
    transportReady() { return this.connected && this.socket.connected && !this.fatal; }
    ready() { return this.transportReady() && !this.recovering && this.identityReady && this.fresh(); }

    connect(restoreIdentity) {
      this.connected = true;
      this.identityReady = !restoreIdentity;
      this.recovering = true;
      this.needsQuizRecovery = true;
      this.lastSync = -Infinity;
      this.requestSync();
      this.onChange();
    }

    disconnect() {
      this.connected = false;
      this.recovering = true;
      this.needsQuizRecovery = true;
      this.taps.clear();
      this.onChange();
    }

    identityRestored() {
      this.identityReady = true;
      this.requireSync();
    }

    requireSync() {
      this.recovering = true;
      this.needsQuizRecovery = true;
      this.requestSync();
      this.onChange();
    }

    requestSync() {
      if (!this.transportReady() || this.now() - this.lastSync < 1000) return;
      this.lastSync = this.now();
      this.socket.emit('guest:sync', {});
    }

    protocolError() {
      this.fatal = true;
      this.recovering = true;
      this.taps.clear();
      this.onChange();
    }

    validEnvelope(data) {
      return data && typeof data.runId === 'string' && data.runId.length > 0
        && Number.isSafeInteger(data.stateVersion) && data.stateVersion >= 0
        && Number.isFinite(data.serverNow);
    }

    observeTime(serverNow) {
      // The fastest observed clock sample is a lower bound for server time.
      // Never move it backwards when delayed packets or reconnect buffers arrive.
      this.offset = Math.max(this.offset ?? -Infinity, serverNow - this.now());
      this.latestServerNow = Math.max(this.latestServerNow, serverNow);
      return this.serverNow() - serverNow <= 3000;
    }

    matches(data) {
      return this.snapshot && data?.runId === this.snapshot.runId
        && data.stateVersion === this.snapshot.stateVersion;
    }

    acceptCurrent(data) {
      if (!this.transportReady() || !this.validEnvelope(data)) return false;
      if (!this.matches(data)) {
        if (!this.retiredRuns.has(data.runId)
          && (!this.snapshot || data.runId !== this.snapshot.runId || data.stateVersion > this.snapshot.stateVersion)) {
          this.requireSync();
        }
        return false;
      }
      return this.observeTime(data.serverNow);
    }

    applySnapshot(data) {
      if (!this.transportReady() || !this.validEnvelope(data) || !data.self
        || this.retiredRuns.has(data.runId)) return false;
      const previous = this.snapshot;
      const newRun = previous && previous.runId !== data.runId;
      if (previous && !newRun && (data.stateVersion < previous.stateVersion
        || data.serverNow < this.snapshotTime)) return false;
      if (!this.observeTime(data.serverNow)) return false;
      if (newRun) {
        this.retiredRuns.add(previous.runId);
        this.taps.clear();
        this.quiz = null;
        this.submission = null;
      }
      const phase = data.quizStage?.phase;
      const oldStage = previous?.quizStage;
      const questionChanged = oldStage?.stageNumber !== data.quizStage?.stageNumber
        || oldStage?.questionNumber !== data.quizStage?.questionNumber;
      if (data.state !== 'QUIZ' || (phase && !['reading', 'answer'].includes(phase)) || questionChanged) {
        this.quiz = null;
        this.submission = null;
      }
      if (!previous || newRun || data.stateVersion !== previous.stateVersion) {
        this.seq = -1;
        this.taps.clear();
        if (data.state === 'QUIZ' && (!phase || ['reading', 'answer'].includes(phase))) this.needsQuizRecovery = true;
      }
      const endsAt = Object.hasOwn(data, 'endsAt') ? data.endsAt : data.quizStage?.endsAt ?? null;
      this.snapshot = { ...data, endsAt };
      this.snapshotTime = data.serverNow;
      if (data.paused && !previous?.paused) this.pausedNow = this.serverNow();
      if (!data.paused) this.pausedNow = null;
      this.recovering = !this.identityReady;
      if (data.state !== 'QUIZ' || (phase && !['reading', 'answer'].includes(phase))) this.needsQuizRecovery = false;
      this.onChange();
      return true;
    }

    heartbeat(data) {
      if (!this.acceptCurrent(data)) return false;
      if (data.state !== this.snapshot.state || !!data.paused !== !!this.snapshot.paused) {
        this.requireSync();
        return false;
      }
      // Resume deadlines must come from a new authoritative state, not a timer restart.
      if (!this.snapshot.paused && Object.hasOwn(data, 'endsAt')) this.snapshot.endsAt = data.endsAt;
      this.onChange();
      return true;
    }

    position(data) {
      if (!Number.isSafeInteger(data?.seq) || data.seq <= this.seq || !this.acceptCurrent(data)) return false;
      this.seq = data.seq;
      this.onChange();
      return true;
    }

    applyOptions(data) {
      if (!this.acceptCurrent(data) || this.snapshot.state !== 'QUIZ'
        || (this.snapshot.quizStage && !['reading', 'answer'].includes(this.snapshot.quizStage.phase))
        || !data.quizId || !Number.isFinite(data.endsAt) || !data.options) return false;
      if (this.needsQuizRecovery && typeof data.alreadyAnswered !== 'boolean') {
        this.requestSync();
        return false;
      }
      const same = this.quiz?.quizId === data.quizId && this.quiz?.runId === data.runId;
      if (!same) this.submission = null;
      this.quiz = { ...data };
      this.needsQuizRecovery = false;
      if (data.alreadyAnswered) {
        this.submission = { ...this.submission, state: 'confirmed', answer: data.receipt?.answer || this.submission?.payload?.answer };
      } else if (this.submission?.state === 'rejected') {
        this.submission = null;
      }
      this.onChange();
      return true;
    }

    beforeDeadline(endsAt) { return endsAt === null || (Number.isFinite(endsAt) && this.serverNow() < endsAt); }
    canTap() {
      const state = this.snapshot;
      return !!(this.ready() && state?.self.joined && state.self.teamId && !state.paused
        && state.state === 'RACING' && (!state.quizStage || ['tap', 'sprint'].includes(state.quizStage.phase))
        && this.beforeDeadline(state.endsAt));
    }

    quizOpen() {
      const state = this.snapshot;
      return !!(this.ready() && !this.needsQuizRecovery && state?.self.joined && state.self.teamId
        && !state.paused && state.state === 'QUIZ' && (!state.quizStage || state.quizStage.phase === 'answer')
        && this.quiz && this.matches(this.quiz) && this.beforeDeadline(this.quiz.endsAt)
        && this.beforeDeadline(state.endsAt));
    }

    canAnswer() { return this.quizOpen() && !this.submission; }

    envelope() {
      return { requestId: this.requestId(), runId: this.snapshot.runId, stateVersion: this.snapshot.stateVersion };
    }

    tap(timestamp) {
      if (!this.canTap()) return false;
      const payload = { ...this.envelope(), timestamp };
      this.taps.set(payload.requestId, { ...payload, sentAt: this.now() });
      this.socket.emit('guest:tap', payload);
      return true;
    }

    tapAck(result) {
      const request = this.taps.get(result?.requestId);
      if (!request || !this.transportReady() || result.runId !== request.runId || !this.matches(request)) return false;
      this.taps.delete(result.requestId);
      return true;
    }

    answer(answer) {
      if (!this.canAnswer()) return false;
      const payload = { ...this.envelope(), quizId: this.quiz.quizId, answer };
      this.submission = { state: 'pending', payload, retries: 0, sentAt: this.now() };
      this.socket.emit('guest:quiz_answer', payload);
      this.onChange();
      return true;
    }

    answerAck(result) {
      const pending = this.submission;
      if (!this.transportReady() || !pending?.payload || pending.state !== 'pending'
        || result?.requestId !== pending.payload.requestId || result.runId !== pending.payload.runId
        || this.snapshot?.runId !== result.runId || this.snapshot.state !== 'QUIZ'
        || (this.snapshot.quizStage && this.snapshot.quizStage.phase !== 'answer')
        || this.quiz?.quizId !== pending.payload.quizId
        || (result.quizId && result.quizId !== this.quiz.quizId)) return false;
      pending.state = result.success ? 'confirmed' : 'rejected';
      if (!result.success) this.requireSync();
      this.onChange();
      return true;
    }

    tick() {
      if (this.transportReady() && (!this.fresh() || this.recovering || this.needsQuizRecovery)) {
        if (!this.fresh()) {
          this.recovering = true;
          this.needsQuizRecovery = true;
        }
        this.requestSync();
      }
      const pending = this.submission;
      if (pending?.state === 'pending' && pending.retries < 2 && this.quizOpen()
        && this.matches(pending.payload) && this.now() - pending.sentAt >= 1000) {
        pending.retries++;
        pending.sentAt = this.now();
        this.socket.emit('guest:quiz_answer', pending.payload);
      }
      for (const [id, tap] of this.taps) if (this.now() - tap.sentAt > 3000) this.taps.delete(id);
      this.onChange();
    }

    status() {
      if (this.fatal) return 'protocol';
      if (!this.transportReady()) return 'offline';
      if (!this.fresh() && this.snapshot) return 'stale';
      if (this.recovering || (this.snapshot?.state === 'QUIZ' && this.needsQuizRecovery)) return 'recovering';
      return 'online';
    }
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = GuestNetwork;
  else root.GuestNetwork = GuestNetwork;
})(typeof window === 'undefined' ? globalThis : window);
