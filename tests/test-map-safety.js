const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const config = require('../server/config');
const MapManager = require('../server/game/MapManager');
const GameManager = require('../server/game/GameManager');
const SocketRouter = require('../server/websocket/SocketRouter');
const { CLIENT_TO_SERVER: C, SERVER_TO_CLIENT: S } = require('../shared/events');

test('map deletion protects formal and final maps without touching files', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lucky-map-safety-'));
  const original = config.paths.maps;
  config.paths.maps = directory;
  t.after(() => {
    config.paths.maps = original;
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('lucky-map-safety-'));
    fs.rmSync(directory, { recursive: true });
  });
  for (const id of ['wedding-final-showdown', 'custom']) {
    fs.writeFileSync(path.join(directory, `${id}.json`), JSON.stringify({ id }));
  }
  const maps = new MapManager();
  const formalPath = path.join(directory, 'wedding-final-showdown.json');
  const before = fs.readFileSync(formalPath, 'utf8');
  assert.equal(maps.deleteMap('wedding-final-showdown'), false);
  assert.equal(maps.getDeleteMapError('wedding-final-showdown'), 'FORMAL_MAP_PROTECTED');
  assert.equal(fs.readFileSync(formalPath, 'utf8'), before);
  assert.equal(maps.maps.size, 2);
  maps.selectMap('custom');
  assert.equal(maps.deleteMap('custom'), true);
  assert.equal(fs.existsSync(path.join(directory, 'custom.json')), false);
  assert.equal(maps.getCurrentMap().id, 'wedding-final-showdown');
  assert.equal(maps.deleteMap('missing'), false);
  maps.maps = new Map([['only-custom', { id: 'only-custom' }]]);
  assert.equal(maps.getDeleteMapError('only-custom'), 'LAST_MAP_PROTECTED');
  assert.equal(maps.deleteMap('only-custom'), false);
});

test('empty maps safely synchronize all roles and reject start without changing flow', t => {
  const io = { on() {}, emit() {}, sockets: { sockets: new Map() },
    to() { return { emit() {} }; } };
  const game = new GameManager(io);
  const router = new SocketRouter(io, game);
  t.after(() => router.delivery.close());
  game.mapManager.maps.clear();
  assert.equal(game.mapManager.getCurrentMap(), null);
  const token = game.flowToken;
  for (const role of ['guest', 'host', 'control', 'admin']) {
    const sent = [];
    router.delivery.sendState({ id: role, data: { role }, emit: (event, data) => sent.push({ event, data }) });
    const snapshot = sent.find(entry => entry.event === S.GAME_STATE_SYNC).data;
    assert.equal(snapshot.currentMap, null);
    assert.equal(snapshot.mapError, 'NO_MAP_AVAILABLE');
    if (role === 'guest') assert.equal(snapshot.players, undefined);
  }
  assert.doesNotThrow(() => game.broadcastStateSync());
  for (const enabled of [true, false]) {
    game.config.quizStages.enabled = enabled;
    assert.equal(game.startRound(), false);
    assert.equal(game.state, 'LOBBY');
    assert.equal(game.flowToken, token);
  }
  const handlers = {}, sent = [];
  const socket = { data: { role: 'admin' }, on: (event, fn) => { handlers[event] = fn; },
    emit: (event, data) => sent.push({ event, data }) };
  router.registerControlEvents(socket);
  handlers[C.CONTROL_START_ROUND]();
  assert.equal(sent.at(-1).data.success, false);
  assert.equal(sent.at(-1).data.reason, 'NO_MAP_AVAILABLE');
  router.adminHandler.register(socket);
  handlers['admin:delete_map']({ mapId: 'wedding-final-showdown' });
  assert.deepEqual(sent.at(-1).data, {
    action: 'DELETE_MAP', success: false, reason: 'FORMAL_MAP_PROTECTED'
  });
});
