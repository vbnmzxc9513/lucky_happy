/**
 * WebSocket 事件清單 (Event Catalog)
 * 任何開發者在加新事件時必須先更新此表與 GAME_DESIGN.md
 */

const CLIENT_TO_SERVER = {
  GUEST_JOIN: 'guest:join',
  GUEST_CHOOSE_TEAM: 'guest:choose_team',
  GUEST_TAP: 'guest:tap',
  GUEST_QUIZ_ANSWER: 'guest:quiz_answer',
  HOST_SELECT_MAP: 'host:select_map',
  HOST_START_ROUND: 'host:start_round',
  HOST_PAUSE_GAME: 'host:pause_game',
  HOST_RESUME_GAME: 'host:resume_game',
  HOST_NEXT_ROUND: 'host:next_round',
  HOST_RESET_GAME: 'host:reset_game',
  // 後台與彩排專用事件
  ADMIN_UPDATE_CONFIG: 'admin:update_config',
  ADMIN_SAVE_MAP: 'admin:save_map',
  ADMIN_SAVE_QUIZ: 'admin:save_quiz',
  ADMIN_SPAWN_BOTS: 'admin:spawn_bots',
  ADMIN_CLEAR_BOTS: 'admin:clear_bots',
  ADMIN_FORCE_TRIGGER: 'admin:force_trigger',
};

const SERVER_TO_CLIENT = {
  GAME_STATE_SYNC: 'game:state_sync',
  GAME_POSITION_UPDATE: 'game:position_update',
  GAME_TEAM_UPDATED: 'game:team_updated',
  GAME_QUIZ_PREPARE: 'game:quiz_prepare',   // 賽前 3 秒倒數
  GAME_QUIZ_START: 'game:quiz_start',       // 僅含題目，發給 Host
  GAME_QUIZ_OPTIONS: 'game:quiz_options',   // 僅含選項，發給 Guest
  GAME_QUIZ_ANSWER_ACK: 'game:quiz_answer_ack', // 答案確認/拒絕回饋
  GAME_QUIZ_RESULT: 'game:quiz_result',
  GAME_ITEM_TRIGGERED: 'game:item_triggered',
  GAME_ROUND_FINISHED: 'game:round_finished',
  GAME_MATCH_FINISHED: 'game:match_finished',
  GAME_ROUND_LOBBY: 'game:round_lobby',
  GAME_JOIN_LOCKED: 'game:join_locked',     // 比賽中拒絕加入
  GAME_MAP_SELECTED: 'game:map_selected',
  GAME_MAP_LIST: 'game:map_list',
  GAME_PLAYER_JOINED: 'game:player_joined',
  SYSTEM_ERROR: 'system:error',
  // 後台專用狀態回饋
  ADMIN_CONFIG_UPDATED: 'admin:config_updated',
  ADMIN_SIMULATION_STATS: 'admin:simulation_stats',
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { CLIENT_TO_SERVER, SERVER_TO_CLIENT };
} else {
  window.GameEvents = { CLIENT_TO_SERVER, SERVER_TO_CLIENT };
}
