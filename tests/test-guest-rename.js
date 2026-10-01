const test = require('node:test');
const assert = require('node:assert/strict');
const GameManager = require('../server/game/GameManager');
const GuestHandler = require('../server/websocket/GuestHandler');
const {SERVER_TO_CLIENT:S} = require('../shared/events');

test('rename preserves identity and team, validates duplicates, locks in play and recovers canonical name', t => {
  const io = {emit(){}, sockets:{sockets:new Map()}, to(){return {emit(){}};}};
  const game = new GameManager(io); t.after(() => { game.delivery = null; game.resetGame(); });
  game.delivery = {sendState(){},scheduleRoster(){}};
  const handler = new GuestHandler(io, game); const events = [];
  const socket = {id:'p1',emit(event,data){if(event===S.GUEST_JOIN_ACK) events.push(data);}};
  const sessionId = 'rename-session-0001';
  handler.handleJoin(socket,{nickname:'Original',sessionId});
  game.teamManager.chooseTeam('p1','red');
  const original = game.teamManager.getPlayer('p1');
  game.playerStats.get('p1').tapCount = 7;
  game.teamManager.addPlayer('p2','Other');
  handler.handleJoin(socket,{rename:true,nickname:'<New&Name>',sessionId:'forged-session-0001'});
  assert.equal(events.at(-1).success,true);
  assert.equal(original.nickname,'<New&Name>');
  assert.equal(game.teamManager.getPlayer('p1'),original);
  assert.equal(original.teamId,'red');
  assert.equal(game.playerStats.get(original.socketId).nickname,'<New&Name>');
  assert.equal(game.playerStats.get(original.socketId).tapCount,7);
  assert.equal(game.teamManager.socketToSession.get('p1'),sessionId);
  for (const nickname of ['OTHER','Ｏｔｈｅｒ']) {
    handler.handleJoin(socket,{rename:true,nickname});
    assert.equal(events.at(-1).reason,'DUPLICATE_NICKNAME');
    assert.equal(original.nickname,'<New&Name>');
  }
  handler.handleJoin(socket,{rename:true,nickname:' '});
  assert.equal(events.at(-1).reason,'INVALID_NICKNAME');
  game.state='RACING'; game.teamManager.setJoinLock(true);
  handler.handleJoin(socket,{rename:true,nickname:'Changed'});
  assert.equal(events.at(-1).reason,'NAME_LOCKED');
  const next = {id:'p3',emit:socket.emit};
  handler.handleJoin(next,{nickname:'Original',sessionId});
  assert.equal(events.at(-1).nickname,'<New&Name>');
  assert.equal(game.teamManager.getPlayer('p3'),original);
  assert.equal(original.teamId,'red');
  assert.equal(game.playerStats.get(original.socketId).nickname,'<New&Name>');
  assert.equal(game.playerStats.get(original.socketId).tapCount,7);
  handler.handleJoin(socket,{rename:true,nickname:'Old socket'});
  assert.equal(events.at(-1).reason,'NOT_JOINED');
  game.delivery=null;
});
