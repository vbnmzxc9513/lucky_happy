const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const GameManager = require('../server/game/GameManager');

// Expected values come from the action plan, never from accepted server counters.
for (const [count, mode] of [[150, 'mixed'], [190, 'mixed'], [150, 'silent']]) {
  test(`Independent player accounting: ${count} players, ${mode}`, t => {
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 1000000 });
    const game = new GameManager({ emit() {} });
    game.startLoop = () => {};
    const report = { count, mode, passed: false, players: [], questions: [], settlements: [], checks: 0 };
    const check = (actual, expected, label) => {
      report.checks++;
      assert.deepEqual(actual, expected, label);
    };
    const advance = ms => {
      for (let n = 0; n < ms; n += 50) t.mock.timers.tick(Math.min(50, ms - n));
    };
    const teams = ['red', 'blue', 'yellow', 'pink', 'purple'];
    const distance = Object.fromEntries(teams.map(id => [id, 10]));
    const players = Array.from({ length: count }, (_, i) => ({
      id: `audit-${i}`, socketId: `p${i}`, sessionId: `accounting-session-${i}`,
      nickname: `Audit${i}`, teamId: teams[i % 5], joinedAt: 1000000 + i,
      taps: 0, correct: 0, wrong: 0, times: [], questions: [], operations: [], reconnects: 0
    }));
    report.players = players;
    const operation = (p, action, expected, execute, detail = {}) => {
      const result = execute();
      p.operations.push({ at: Date.now(), action, ...detail, expected, actual: result });
      check(result.success, expected, `${p.id}: ${action}`);
      return result;
    };
    const answer = (p, id, value, expected) => operation(p, 'answer', expected,
      () => game.handleQuizAnswer(p.socketId, id, value), { quizId: id, answer: value });
    const tap = (p, expected) => operation(p, 'tap', expected,
      () => game.handleTap(p.socketId, Date.now()));
    const verifyPlayer = p => {
      const s = game.playerStats.get(p.socketId);
      const expected = { tapCount: p.taps, answeredCount: p.times.length,
        correctCount: p.correct, wrongCount: p.wrong,
        answerTimedCount: p.times.length, answerTimeTotalMs: p.times.reduce((a, b) => a + b, 0),
        fastestAnswerMs: p.times.length ? Math.min(...p.times) : null };
      for (const [key, value] of Object.entries(expected)) check(s[key], value, `${p.id}: ${key}`);
      check(p.correct + p.wrong, p.times.length, `${p.id}: answer conservation`);
      p.expected = { ...expected, unansweredCount: p.questions.filter(q => q.answer === null).length };
      p.actual = Object.fromEntries(Object.keys(expected).map(key => [key, s[key]]));
      p.actual.unansweredDerived = p.questions.length - s.answeredCount;
      check(p.actual.unansweredDerived, p.expected.unansweredCount, `${p.id}: unanswered conservation`);
    };
    try {
      for (const p of players) {
        check(game.teamManager.addPlayer(p.socketId, p.nickname, 'A', p.sessionId).success, true, 'join');
        check(game.teamManager.chooseTeam(p.socketId, p.teamId).success, true, 'team');
        game.teamManager.getPlayer(p.socketId).joinedAt = p.joinedAt;
        game.upsertPlayerStats(game.teamManager.getPlayer(p.socketId));
        tap(p, false);
      }
      // Fixed answer fixtures make the oracle independent of production answer normalization.
      const originalLoad = game.quizLoader.getQuizById.bind(game.quizLoader);
      game.quizLoader.getQuizById = id => originalLoad(id)
        ? { id, question: 'Accounting fixture', options: ['Correct', 'Wrong', 'Other', 'Other2'], correctAnswer: 'A', timeLimit: 10 }
        : null;
      check(game.startRound(), true, 'start');
      check(game.startRound(), false, 'duplicate start');
      advance(3000);
      for (let stage = 0; stage < 6; stage++) {
        check(game.quizStage.phase, 'tap', 'tap phase');
        const tapStart = Date.now();
        for (let batch = 0; batch < 21; batch++) {
          advance(100);
          for (let i = 0; i < count; i++) {
            const p = players[i];
            if (mode === 'silent' || batch > i % 22) continue;
            p.taps++;
            check(tap(p, true).critical, p.taps % 20 === 0, 'critical every 20 accepted taps');
            check(tap(p, false).reason, 'TAP_COOLDOWN', 'duplicate tap rejected');
          }
        }
        advance(8000 - (Date.now() - tapStart));
        advance(3000);
        const stageCorrect = Object.fromEntries(teams.map(id => [id, 0]));
        for (let q = 0; q < 3; q++) {
          check(game.quizStage.phase, 'answer', 'question phase');
          const id = game.quizManager.currentQuiz.id;
          const votes = Object.fromEntries(teams.map(tid => [tid, { A: 0, B: 0 }]));
          const began = Date.now();
          if (stage === 0 && q === 0) {
            game.pauseGame();
            for (const p of players) {
              answer(p, id, 'A', false);
              tap(p, false);
            }
            advance(2000);
            game.resumeGame();
          }
          const pausedMs = stage === 0 && q === 0 ? 2000 : 0;
          for (let i = 0; i < count; i++) {
            const p = players[i];
            advance(1);
            // Entire red team skips; blue is correct; yellow is wrong; pink ties;
            // purple alternates correct/incorrect/skip across questions.
            const member = Math.floor(i / 5);
            const value = mode === 'silent' || p.teamId === 'red' ? null
              : p.teamId === 'blue' ? 'A' : p.teamId === 'yellow' ? 'B'
                : p.teamId === 'pink' ? (member % 2 ? 'B' : 'A')
                  : q === 2 ? null : q === 0 ? 'A' : 'B';
            p.questions.push({ id, answer: value, correct: value === 'A' });
            tap(p, false);
            answer(p, 'stale-question', 'A', false);
            answer(p, id, 'Z', false);
            if (value !== null) {
              const elapsed = Date.now() - began - pausedMs;
              p.times.push(elapsed);
              if (value === 'A') p.correct++; else p.wrong++;
              votes[p.teamId][value]++;
              const ack = answer(p, id, value, true);
              check(ack.isCorrect, value === 'A', 'individual answer truth');
              check(ack.answerTimeMs, elapsed, 'pause excluded from response time');
              if (stage === 1 && q === 1 && i < 15) {
                const old = p.socketId;
                game.teamManager.disconnectPlayer(old, true);
                p.socketId = `reconnected-${i}`;
                const joined = game.teamManager.addPlayer(p.socketId, p.nickname, 'A', p.sessionId);
                check(joined.reconnected, true, 'stable identity reconnect');
                game.migratePlayerConnection(joined.previousSocketId, p.socketId);
                p.reconnects++;
                p.operations.push({ at: Date.now(), action: 'reconnect', oldSocketId: old, socketId: p.socketId });
                answer({ ...p, socketId: old }, id, value, false);
              }
              check(answer(p, id, value === 'A' ? 'B' : 'A', false).reason, 'ALREADY_ANSWERED', 'answer lock');
            }
            verifyPlayer(p);
          }
          advance(10000 - count);
          check(game.quizStage.phase, 'reveal', 'deadline');
          const result = game.quizStage.reveal;
          for (const tid of teams) {
            const expectedCorrect = votes[tid].A > votes[tid].B;
            check(result.teamResults[tid].isCorrect, expectedCorrect, `team plurality ${tid}`);
            check(result.teamResults[tid].answeredCount, votes[tid].A + votes[tid].B, 'vote conservation');
            check(result.teamResults[tid].correctCount, votes[tid].A, 'correct people per question');
            check(result.teamResults[tid].wrongCount, votes[tid].B, 'wrong people per question');
            check(result.teamResults[tid].unansweredCount, count / 5 - votes[tid].A - votes[tid].B, 'unanswered people per question');
            if (expectedCorrect) stageCorrect[tid]++;
          }
          report.questions.push({ id, votes, result: structuredClone(result) });
          for (const p of players) answer(p, id, 'A', false);
          game.handleQuizResults(result);
          advance(6000);
        }
        for (const tid of teams) {
          const reward = [0, 1500, 3000, 6000][stageCorrect[tid]];
          distance[tid] += reward;
          const actual = game.quizStage.summary.teamResults[tid];
          check(actual.rewardPx, reward, 'stage reward');
          check(game.teamManager.teams[tid].position, distance[tid], 'distance conservation');
          report.settlements.push({ stage: stage + 1, teamId: tid, reward, distance: distance[tid] });
        }
        check(game.showStageSummary(game.flowToken), false, 'no second payout');
        advance(8000);
      }
      advance(15000);
      check(game.state, 'MATCH_FINISHED', 'match completed');
      const awards = game.buildFinalAwardsPayload().awards;
      check(awards.length, 4, 'four awards');
      for (const p of players) {
        verifyPlayer(p);
        check(p.expected.unansweredCount + p.times.length, 18, 'all questions accounted');
      }
      for (const [id, key, speed, positive] of [
        ['most-correct', 'correct', true, true], ['highest-clicks', 'taps', false, false],
        ['most-wrong', 'wrong', true, true]
      ]) {
        const ranking = players.filter(p => !positive || p[key] > 0).sort((a, b) =>
          b[key] - a[key] || (speed ? a.times.reduce((x, y) => x + y, 0) / a.times.length
            - b.times.reduce((x, y) => x + y, 0) / b.times.length : 0) || a.joinedAt - b.joinedAt);
        const actual = awards.find(a => a.id === id);
        check(actual.ranking.map(p => p.name), ranking.map(p => p.nickname), `${id}: entire ranking`);
        check(actual.winner.name, ranking[0]?.nickname || '尚無紀錄', `${id}: winner`);
      }
      check(awards[0].winner.id, mode === 'silent' ? 'tie' : 'blue', 'team champion');
      report.awards = awards;
      game.resetGame();
      advance(60000);
      check(game.playerStats.size, 0, 'reset clears personal stats');
      check(game.teamManager.players.size, 0, 'reset clears players');
      check(game.state, 'LOBBY', 'no ghost timers');
      report.passed = true;
    } catch (error) {
      report.error = error.stack;
      throw error;
    } finally {
      game.resetGame();
      const file = path.resolve('reports/accounting', `${count}-${mode}.json`);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(report, null, 2));
      const columns = ['player', 'team', 'passed', 'tapAttempts', 'acceptedTaps', 'actualTaps',
        'criticalTaps', 'answered', 'actualAnswered', 'correct', 'actualCorrect', 'wrong',
        'actualWrong', 'unansweredExpected', 'unansweredDerived', 'answerTimeTotalMs', 'actualAnswerTimeTotalMs', 'reconnects'];
      const rows = players.map(p => [p.nickname, p.teamId, report.passed,
        p.operations.filter(o => o.action === 'tap').length, p.taps, p.actual?.tapCount,
        Math.floor(p.taps / 20), p.times.length, p.actual?.answeredCount,
        p.correct, p.actual?.correctCount, p.wrong, p.actual?.wrongCount,
        p.expected?.unansweredCount, p.actual?.unansweredDerived, p.times.reduce((a, b) => a + b, 0),
        p.actual?.answerTimeTotalMs, p.reconnects]);
      const csv = [columns, ...rows].map(row => row.map(value =>
        `"${String(value ?? '').replaceAll('"', '""')}"`).join(',')).join('\r\n');
      fs.writeFileSync(file.replace(/\.json$/, '.csv'), '\uFEFF' + csv);
      console.log(`Accounting report: ${file} (${report.checks} checks)`);
    }
  });
}
