const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const copy = value => JSON.parse(JSON.stringify(value));
class MatchResultStore {
  constructor(file = process.env.MATCH_RESULTS_FILE || path.join(__dirname, '../../data/runtime/match-results.json'), io = fs) {
    this.file = file;
    this.io = io;
    this.matches = [];
    this.seen = new Set();
    this.status = { ok: true, lastSavedAt: null, errorCode: null };
    this.blocked = false;
    this.load();
  }
  fail(code, error) {
    this.status.ok = false;
    this.status.errorCode = code;
    console.error(`[match-results] ${code}`, error);
  }
  load() {
    let raw;
    try { raw = this.io.readFileSync(this.file, 'utf8'); }
    catch (error) {
      if (error.code !== 'ENOENT') { this.blocked = true; this.fail('RESULT_READ_FAILED', error); }
      return;
    }
    try {
      const data = JSON.parse(raw);
      if (data.schemaVersion !== 1 || !Array.isArray(data.matches) || data.matches.some(m =>
        !m || typeof m.id !== 'string' || !Number.isFinite(Date.parse(m.finishedAt)) ||
        !Array.isArray(m.players) || !Array.isArray(m.teams) || !Array.isArray(m.awards) ||
        !m.map || !m.winner || !Array.isArray(m.winner.teamIds))) throw new Error('Invalid results schema');
      this.matches = data.matches.filter(m => { if (this.seen.has(m.id)) return false; this.seen.add(m.id); return true; })
        .sort((a, b) => Date.parse(b.finishedAt) - Date.parse(a.finishedAt)).slice(0, 10);
      this.status.lastSavedAt = data.updatedAt || null;
    } catch (error) {
      this.fail('RESULT_FILE_CORRUPT', error);
      try { this.io.renameSync(this.file, this.file.replace(/\.json$/, '') + `.corrupt-${Date.now()}-${randomUUID()}.json`); }
      catch (backupError) { this.blocked = true; this.fail('RESULT_BACKUP_FAILED', backupError); }
    }
  }
  read() { return copy({ schemaVersion: 1, matches: this.matches, storage: this.status }); }
  add(snapshot) {
    if (this.seen.has(snapshot.id)) return false;
    const match = copy(snapshot);
    this.seen.add(match.id);
    this.matches = [match, ...this.matches].sort((a, b) => Date.parse(b.finishedAt) - Date.parse(a.finishedAt)).slice(0, 10);
    const updatedAt = new Date().toISOString();
    let temp;
    try {
      if (this.blocked) throw new Error('Results storage blocked to preserve original file');
      this.io.mkdirSync(path.dirname(this.file), { recursive: true });
      temp = `${this.file}.${randomUUID()}.tmp`;
      const fd = this.io.openSync(temp, 'wx', 0o600);
      try {
        this.io.writeFileSync(fd, JSON.stringify({ schemaVersion: 1, updatedAt, matches: this.matches }, null, 2), 'utf8');
        this.io.fsyncSync(fd);
      } finally { this.io.closeSync(fd); }
      this.io.renameSync(temp, this.file);
      this.status.ok = true;
      this.status.lastSavedAt = updatedAt;
      // Keep a corruption warning visible for this process even after subsequent saves.
      if (this.status.errorCode !== 'RESULT_FILE_CORRUPT') this.status.errorCode = null;
      return true;
    } catch (error) { this.fail('RESULT_SNAPSHOT_FAILED', error); return false; }
    finally { if (temp) { try { this.io.unlinkSync(temp); } catch {} } }
  }
}
module.exports = MatchResultStore;
