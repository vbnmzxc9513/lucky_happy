'use strict';
const $ = id => document.getElementById(id);
const node = (tag, text, className) => { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (className) el.className = className; return el; };
let matches = [];
const selected = () => matches.find(m => m.id === $('matches').value);
const time = n => `${(Number(n || 0) / 1000).toFixed(2)} 秒`;
function renderPlayers() {
  const m = selected(); if (!m) return;
  let players = m.players.filter(p => (!$('team').value || p.teamId === $('team').value) && (!$('only-winners').checked || m.winner.teamIds.includes(p.teamId)));
  const sort = $('sort').value;
  players.sort((a, b) => sort === 'nickname' ? a.nickname.localeCompare(b.nickname, 'zh-Hant') : b[sort] - a[sort] || a.nickname.localeCompare(b.nickname, 'zh-Hant'));
  $('count').textContent = `顯示 ${players.length} / ${m.players.length} 位玩家`;
  $('players').replaceChildren(...players.map(p => {
    const card = node('article', undefined, 'card'); card.append(node('h3', `${p.avatar} ${p.nickname}`), node('p', p.teamName));
    const dl = node('dl');
    for (const [label, value] of [['點擊數', p.tapCount], ['作答數', p.answeredCount], ['答對數', p.correctCount], ['答錯數', p.wrongCount], ['未作答數', p.unansweredCount], ['正確率', `${(p.accuracy * 100).toFixed(1)}%`], ['平均答題時間', time(p.averageAnswerMs)], ['最快答題時間', time(p.fastestAnswerMs)]]) dl.append(node('dt', label), node('dd', value));
    card.append(dl); return card;
  }));
}
function render() {
  const m = selected(); $('detail').hidden = !m; $('empty').hidden = matches.length > 0; if (!m) return;
  const winners = m.teams.filter(t => m.winner.teamIds.includes(t.id));
  $('summary').textContent = `${m.winner.type === 'tie' ? '並列勝隊' : '勝隊'}：${winners.map(t => t.name).join('、')}`;
  $('metadata').textContent = `${new Date(m.finishedAt).toLocaleString('zh-TW')} · ${m.map.name} · ${m.questionCount} 題 / ${m.stageCount} 關`;
  $('winners').replaceChildren(...winners.map(t => {
    const card = node('article', undefined, 'card'); const members = m.players.filter(p => p.teamId === t.id);
    card.append(node('h3', `${t.name}（${members.length} 人）`)); const ul = node('ul', undefined, 'members');
    ul.append(...members.map(p => node('li', `${p.avatar} ${p.nickname}`))); card.append(ul); return card;
  }));
  $('teams').replaceChildren(...m.teams.map(t => { const card = node('article', undefined, 'card'); card.append(node('h3', `第 ${t.rank} 名 · ${t.name}`), node('p', `總距離 ${window.DistanceDisplay.position(t.position)} · ${t.memberCount} 人`)); return card; }));
  $('team').replaceChildren(new Option('全部隊伍', ''), ...m.teams.map(t => new Option(t.name, t.id)));
  renderPlayers();
}
async function refresh() {
  $('refresh').disabled = true;
  try {
    const response = await fetch('/api/match-results', { cache: 'no-store' });
    if (response.redirected || response.status === 401) { location.assign('/staff-login?next=%2Fresults%2F'); return; }
    if (!response.ok) throw new Error('HTTP');
    const data = await response.json(); const previous = $('matches').value; matches = data.matches;
    $('warning').textContent = data.storage.errorCode || !data.storage.ok ? '成績儲存發生異常。部分紀錄可能尚未寫入磁碟，請聯絡維運人員檢查並備份；損毀檔案會保留備份。' : '';
    $('matches').replaceChildren(...matches.map(m => new Option(`${new Date(m.finishedAt).toLocaleString('zh-TW')} · ${m.map.name}`, m.id)));
    if (matches.some(m => m.id === previous)) $('matches').value = previous;
    render();
  } catch { $('warning').textContent = '無法讀取成績，請確認網路或重新登入後再試。'; }
  finally { $('refresh').disabled = false; }
}
function download(content, type, extension) {
  const url = URL.createObjectURL(new Blob([content], { type })); const a = node('a'); a.href = url; a.download = `match-result.${extension}`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$('json').onclick = () => { const m = selected(); if (m) download(JSON.stringify({ schemaVersion: 1, match: m }, null, 2), 'application/json', 'json'); };
$('csv').onclick = () => {
  const m = selected(); if (!m) return;
  const keys = ['nickname', 'avatar', 'teamName', 'tapCount', 'answeredCount', 'correctCount', 'wrongCount', 'unansweredCount', 'accuracy', 'averageAnswerMs', 'fastestAnswerMs'];
  const cell = v => { let text = String(v ?? ''); if (/^[\s]*[=+@-]/.test(text)) text = "'" + text; return '"' + text.replace(/"/g, '""') + '"'; };
  download('\uFEFF' + [keys, ...m.players.map(p => keys.map(k => p[k]))].map(row => row.map(cell).join(',')).join('\r\n'), 'text/csv;charset=utf-8', 'csv');
};
$('refresh').onclick = refresh; $('matches').onchange = render;
for (const id of ['team', 'only-winners', 'sort']) $(id).onchange = renderPlayers;
refresh();
