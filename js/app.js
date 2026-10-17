import * as C from './core.js';
import { loadState, saveState, clearState, requestPersistence } from './storage.js';

const LEVEL_NAMES = { 1: 'Fácil', 2: 'Médio', 3: 'Difícil' };
const LEVEL_DESC = {
  1: 'Escolha entre opções. Reconhecer o padrão certo.',
  2: 'Complete e corrija frases. Produzir a forma certa.',
  3: 'Estruturas mais traiçoeiras e ordenação de frases.',
};
const TYPE_LABEL = { mcq: 'Escolha a opção', fix: 'Escolha a versão correta', gap: 'Complete a lacuna', order: 'Ordene a frase' };
const SESSION_SIZE = 10;

const app = {
  state: C.emptyState(),
  topics: [],      // [{group, ...topic}]
  groups: [],
  items: [],
  byId: new Map(),
  session: null,   // sessão em andamento (somente memória)
};

const $main = () => document.getElementById('main');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = v => (v == null ? '—' : `${Math.round(v * 100)}%`);
const topicById = id => app.topics.find(t => t.id === id);

/* ---------- Inicialização ---------- */

async function init() {
  app.state = loadState();
  try {
    const topicsData = await fetchJSON('data/topics.json');
    app.groups = topicsData.groups;
    app.topics = topicsData.groups.flatMap(g => g.topics.map(t => ({ ...t, group: g.id })));
    const banks = await Promise.all(app.topics.map(t => fetchJSON(`data/${t.id}.json`).catch(() => ({ items: [] }))));
    for (const b of banks) {
      for (const it of b.items || []) {
        const errs = C.validateItem(it);
        if (errs.length) { console.warn('Item ignorado', it && it.id, errs); continue; }
        if (app.byId.has(it.id)) continue;
        app.items.push(it);
        app.byId.set(it.id, it);
      }
    }
  } catch (e) {
    $main().innerHTML = `<section class="card"><h2>Não foi possível carregar os exercícios</h2><p>${esc(e.message)}</p><button class="btn" onclick="location.reload()">Tentar de novo</button></section>`;
    return;
  }
  window.addEventListener('hashchange', route);
  document.addEventListener('keydown', onKey);
  route();
  requestPersistence();
  registerSW();
}

async function fetchJSON(url) {
  const r = await fetch(url, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
}

function persist() {
  if (!saveState(app.state)) toast('Não consegui salvar o progresso neste aparelho. Exporte um backup em Ajustes.');
}

/* ---------- Rotas ---------- */

function route() {
  const h = location.hash.replace(/^#\/?/, '');
  const [page, arg] = h.split('/');
  if (page !== 'session') app.session = null;
  setNav(page || 'home');
  window.scrollTo(0, 0);
  if (page === 'topic' && topicById(arg)) return renderTopic(arg);
  if (page === 'session' && app.session) return renderQuestion();
  if (page === 'history') return renderHistory();
  if (page === 'settings') return renderSettings();
  if (page && page !== 'home') { location.hash = '#/'; return; }
  renderHome();
}

function setNav(page) {
  const key = page === 'topic' || page === 'session' ? 'home' : page;
  document.querySelectorAll('.tabbar a').forEach(a => a.setAttribute('aria-current', a.dataset.page === key ? 'page' : 'false'));
  document.querySelector('.tabbar').hidden = page === 'session';
}

/* ---------- Início ---------- */

function renderHome() {
  const now = Date.now();
  const st = app.state;
  const due = C.dueCount(app.items, st, now);
  const week = C.periodAccuracy(st, 7, now);
  const today = C.dailySeries(st, 1, now)[0];
  const strk = C.streak(st, now);

  const groups = app.groups.map(g => `
    <section class="group">
      <div class="group-head"><h2>${esc(g.title)}</h2><span class="pill">${esc(g.level)}</span></div>
      <div class="topic-list">
        ${g.topics.map(t => topicCard(t)).join('')}
      </div>
    </section>`).join('');

  $main().innerHTML = `
    <header class="page-head">
      <p class="eyebrow">Trilha de Inglês</p>
      <h1>${greeting()}</h1>
    </header>
    <div class="stats">
      <div class="stat"><span class="stat-n">${strk}</span><span class="stat-l">${strk === 1 ? 'dia seguido' : 'dias seguidos'}</span></div>
      <div class="stat"><span class="stat-n">${today.total}</span><span class="stat-l">respostas hoje</span></div>
      <div class="stat"><span class="stat-n">${pct(week.acc)}</span><span class="stat-l">acerto em 7 dias</span></div>
    </div>
    <button class="review ${due ? '' : 'is-empty'}" id="review-btn" ${due ? '' : 'disabled'}>
      <span><strong>Revisão do dia</strong><br><small>${due ? `${due} ${due === 1 ? 'exercício pendente' : 'exercícios pendentes'}` : 'Nada pendente. Volte amanhã.'}</small></span>
      <span class="review-n" aria-hidden="true">${due ? '→' : '✓'}</span>
    </button>
    ${groups}
    <p class="foot-note">${app.items.length} exercícios disponíveis · os próximos lotes entram em novas versões</p>`;

  const rb = document.getElementById('review-btn');
  if (due) rb.addEventListener('click', () => startSession({ mode: 'review' }));
}

function topicCard(t) {
  const levels = C.LEVELS.map(lv => {
    const s = C.topicLevelStats(app.state, t.id, lv);
    const cls = s.acc == null ? '' : s.acc >= 0.8 ? 'good' : s.acc >= 0.6 ? 'mid' : 'low';
    return `<span class="lv ${cls}" >${LEVEL_NAMES[lv]} ${pct(s.acc)}</span>`;
  }).join('');
  return `<a class="topic" href="#/topic/${t.id}">
      <span class="topic-title">${esc(t.title)}</span>
      <span class="topic-short">${esc(t.short)}</span>
      <span class="lvs">${levels}</span>
    </a>`;
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
}

/* ---------- Tema ---------- */

function renderTopic(id) {
  const t = topicById(id);
  const sug = C.suggestedLevel(app.state, id);
  const levels = C.LEVELS.map(lv => {
    const s = C.topicLevelStats(app.state, id, lv);
    const cov = C.coverage(app.items, app.state, id, lv);
    return `<button class="level-btn ${lv === sug ? 'is-suggested' : ''}" data-level="${lv}">
        <span class="level-top"><strong>${LEVEL_NAMES[lv]}</strong>${lv === sug ? '<span class="pill pill-accent">sugerido</span>' : ''}</span>
        <span class="level-desc">${LEVEL_DESC[lv]}</span>
        <span class="level-meta">Acerto recente: <b>${pct(s.acc)}</b> · Vistos: ${cov.seen}/${cov.total}</span>
      </button>`;
  }).join('');

  $main().innerHTML = `
    <a class="back" href="#/">← Início</a>
    <header class="page-head"><h1>${esc(t.title)}</h1><p class="lead">${esc(t.short)}</p></header>
    <details class="card rules" open>
      <summary>Regras-chave</summary>
      <ul>${t.rules.map(r => `<li>${esc(r)}</li>`).join('')}</ul>
    </details>
    <h2 class="section-title">Escolha o nível</h2>
    <div class="levels">${levels}</div>
    <button class="btn btn-ghost wide" id="mixed">Sessão mista (todos os níveis)</button>`;

  $main().querySelectorAll('.level-btn').forEach(b =>
    b.addEventListener('click', () => startSession({ topic: id, level: Number(b.dataset.level) })));
  document.getElementById('mixed').addEventListener('click', () => startSession({ topic: id, level: null }));
}

/* ---------- Sessão ---------- */

function startSession({ topic = null, level = null, mode = 'topic', ids = null }) {
  const queue = C.buildSession(app.items, app.state, { topic, level, mode, ids, size: SESSION_SIZE });
  if (!queue.length) { toast('Não há exercícios para esta seleção.'); return; }
  app.session = {
    record: { id: `s${Date.now()}`, ts: Date.now(), mode, topic, level, answers: [] },
    queue, index: 0, answered: false, response: null, results: [],
    backHash: topic ? `#/topic/${topic}` : '#/',
  };
  if (location.hash === '#/session') renderQuestion(); else location.hash = '#/session';
}

function currentItem() { return app.session.queue[app.session.index]; }

function renderQuestion() {
  const s = app.session;
  const it = currentItem();
  s.answered = false;
  s.response = it.type === 'order' ? [] : null;
  const t = topicById(it.topic);
  const progress = Math.round((s.index / s.queue.length) * 100);

  $main().innerHTML = `
    <div class="session-top">
      <button class="icon-btn" id="quit" aria-label="Encerrar sessão">✕</button>
      <div class="bar" role="progressbar" aria-valuenow="${s.index}" aria-valuemax="${s.queue.length}"><span style="width:${progress}%"></span></div>
      <span class="count">${s.index + 1}/${s.queue.length}</span>
    </div>
    <p class="q-meta">${esc(t ? t.title : '')} · ${LEVEL_NAMES[it.level]}</p>
    <section class="q card">
      <p class="q-type">${TYPE_LABEL[it.type]}</p>
      <div id="q-body">${questionBody(it)}</div>
    </section>
    <div id="feedback" aria-live="polite"></div>
    <div class="actions"><button class="btn wide" id="check" disabled>Verificar</button></div>`;

  document.getElementById('quit').addEventListener('click', quitSession);
  bindQuestion(it);
  const input = document.getElementById('gap-input');
  if (input) input.focus();
}

function questionBody(it) {
  if (it.type === 'mcq') {
    return `<p class="q-text">${gapHtml(it.prompt)}</p>${optionsHtml(it.options)}`;
  }
  if (it.type === 'fix') {
    return `<p class="q-wrong"><span class="tag-wrong">Frase com erro</span>${esc(it.prompt)}</p>${optionsHtml(it.options)}`;
  }
  if (it.type === 'gap') {
    const [a, b] = it.prompt.split('___');
    return `<label class="q-text gap-line" for="gap-input">${esc(a)}<input id="gap-input" class="gap-input" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="done" aria-label="Resposta">${esc(b)}</label>`;
  }
  if (it.type === 'order') {
    const { words, punct } = C.orderTokens(it);
    const shuffled = shuffledDifferent(words);
    return `<div class="order-line" id="order-line" aria-label="Sua frase"><span class="placeholder">Toque nas palavras abaixo</span></div>
      <p class="order-punct">${punct ? `Pontuação final: <b>${esc(punct)}</b>` : ''}</p>
      <div class="chips" id="chips">${shuffled.map((w, i) => `<button class="chip" data-i="${i}">${esc(w)}</button>`).join('')}</div>`;
  }
  return '';
}

function shuffledDifferent(words) {
  if (words.length < 2) return words;
  for (let k = 0; k < 10; k++) {
    const s = C.shuffle(words);
    if (s.join(' ') !== words.join(' ')) return s;
  }
  return words.slice().reverse();
}

const gapHtml = p => esc(p).replace('___', '<span class="blank">_____</span>');
const optionsHtml = opts => `<div class="options">${C.shuffle(opts).map(o => `<button class="option" data-v="${esc(o)}">${esc(o)}</button>`).join('')}</div>`;

function bindQuestion(it) {
  const check = document.getElementById('check');
  if (it.type === 'mcq' || it.type === 'fix') {
    $main().querySelectorAll('.option').forEach(b => b.addEventListener('click', () => {
      if (app.session.answered) return;
      $main().querySelectorAll('.option').forEach(x => x.classList.remove('is-selected'));
      b.classList.add('is-selected');
      app.session.response = b.dataset.v;
      check.disabled = false;
    }));
  }
  if (it.type === 'gap') {
    const input = document.getElementById('gap-input');
    input.addEventListener('input', () => { app.session.response = input.value; check.disabled = !input.value.trim(); });
  }
  if (it.type === 'order') {
    const line = document.getElementById('order-line');
    const chips = document.getElementById('chips');
    const total = chips.children.length;
    const refresh = () => {
      app.session.response = [...line.querySelectorAll('.chip')].map(c => c.textContent);
      line.querySelector('.placeholder')?.toggleAttribute('hidden', app.session.response.length > 0);
      check.disabled = app.session.response.length !== total;
    };
    chips.addEventListener('click', e => {
      const c = e.target.closest('.chip'); if (!c || app.session.answered) return;
      line.appendChild(c); refresh();
    });
    line.addEventListener('click', e => {
      const c = e.target.closest('.chip'); if (!c || app.session.answered) return;
      chips.appendChild(c); refresh();
    });
  }
  check.addEventListener('click', submitAnswer);
}

function submitAnswer() {
  const s = app.session;
  if (!s || s.answered) return;
  const it = currentItem();
  if (it.type === 'gap' && !String(s.response || '').trim()) return;
  if (it.type === 'order' && s.response.length !== C.orderTokens(it).words.length) return;
  if ((it.type === 'mcq' || it.type === 'fix') && s.response == null) return;

  const ok = C.checkAnswer(it, s.response);
  s.answered = true;
  s.results.push({ id: it.id, ok });
  C.recordAnswer(app.state, s.record, it, ok);
  persist();

  // Marcações visuais
  if (it.type === 'mcq' || it.type === 'fix') {
    $main().querySelectorAll('.option').forEach(b => {
      b.disabled = true;
      if (b.dataset.v === it.answer) b.classList.add('is-correct');
      else if (b.classList.contains('is-selected')) b.classList.add('is-wrong');
    });
  }
  if (it.type === 'gap') {
    const input = document.getElementById('gap-input');
    input.readOnly = true;
    input.classList.add(ok ? 'is-correct' : 'is-wrong');
  }
  if (it.type === 'order') {
    document.getElementById('order-line').classList.add(ok ? 'is-correct' : 'is-wrong');
    $main().querySelectorAll('.chip').forEach(c => { c.disabled = true; });
  }

  const last = s.index === s.queue.length - 1;
  document.getElementById('feedback').innerHTML = `
    <div class="fb ${ok ? 'fb-ok' : 'fb-bad'}">
      <p class="fb-title">${ok ? 'Correto!' : 'Não foi dessa vez.'}</p>
      ${ok ? '' : `<p class="fb-answer">Resposta: <b>${esc(C.correctAnswerText(it))}</b></p>`}
      <p class="fb-explain">${esc(it.explain)}</p>
    </div>`;
  const btn = document.getElementById('check');
  btn.textContent = last ? 'Ver resultado' : 'Continuar';
  btn.disabled = false;
  btn.removeEventListener('click', submitAnswer);
  btn.addEventListener('click', nextQuestion, { once: true });
  btn.focus();
}

function nextQuestion() {
  const s = app.session;
  if (!s) return;
  if (s.index < s.queue.length - 1) { s.index++; renderQuestion(); window.scrollTo(0, 0); }
  else renderSummary();
}

function renderSummary() {
  const s = app.session;
  const correct = s.results.filter(r => r.ok).length;
  const wrong = s.results.filter(r => !r.ok).map(r => app.byId.get(r.id));
  const ratio = correct / s.results.length;
  const msg = ratio === 1 ? 'Perfeito!' : ratio >= 0.8 ? 'Muito bom.' : ratio >= 0.6 ? 'Bom caminho.' : 'Vale revisar as regras e tentar de novo.';
  const back = s.backHash;
  const wrongIds = wrong.map(w => w.id);

  $main().innerHTML = `
    <section class="summary card">
      <p class="eyebrow">Sessão concluída</p>
      <p class="score">${correct}<span>/${s.results.length}</span></p>
      <p class="lead">${msg}</p>
    </section>
    ${wrong.length ? `<h2 class="section-title">Para rever</h2>
    <div class="wrong-list">${wrong.map(w => `
      <div class="card wrong-item">
        <p class="wi-q">${w.type === 'order' ? 'Ordenação' : esc(w.prompt)}</p>
        <p class="wi-a">${esc(C.correctAnswerText(w))}</p>
        <p class="wi-e">${esc(w.explain)}</p>
      </div>`).join('')}</div>` : ''}
    <div class="actions stack">
      ${wrong.length ? '<button class="btn wide" id="retry">Refazer os que errei</button>' : ''}
      <button class="btn ${wrong.length ? 'btn-ghost' : ''} wide" id="again">Nova sessão</button>
      <a class="btn btn-ghost wide" href="${back}">Voltar</a>
    </div>`;

  const rec = s.record;
  document.getElementById('again').addEventListener('click', () => startSession({ topic: rec.topic, level: rec.level, mode: rec.mode }));
  const retry = document.getElementById('retry');
  if (retry) retry.addEventListener('click', () => startSession({ topic: rec.topic, level: rec.level, mode: 'retry', ids: wrongIds }));
  document.querySelector('.tabbar').hidden = false;
}

function quitSession() {
  const s = app.session;
  const back = s ? s.backHash : '#/';
  if (s && s.results.length && !confirm('Encerrar a sessão? As respostas dadas até aqui já estão salvas.')) return;
  app.session = null;
  location.hash = back;
}

function onKey(e) {
  if (!app.session || location.hash !== '#/session') return;
  if (e.key === 'Enter') {
    const btn = document.getElementById('check');
    if (btn && !btn.disabled && document.activeElement !== btn) { e.preventDefault(); btn.click(); }
  }
}

/* ---------- Histórico ---------- */

function renderHistory() {
  const now = Date.now();
  const st = app.state;
  const series = C.dailySeries(st, 30, now);
  const max = Math.max(5, ...series.map(d => d.total));
  const W = 300, H = 120, bw = W / series.length;
  const bars = series.map((d, i) => {
    const h = (d.total / max) * (H - 10);
    const hc = (d.correct / max) * (H - 10);
    const x = i * bw + 1;
    return `<rect x="${x}" y="${H - h}" width="${bw - 2}" height="${h}" class="bar-total"><title>${d.day}: ${d.correct}/${d.total}</title></rect>
            <rect x="${x}" y="${H - hc}" width="${bw - 2}" height="${hc}" class="bar-ok"/>`;
  }).join('');
  const m30 = C.periodAccuracy(st, 30, now);
  const all = C.allAnswers(st);

  const table = app.topics.map(t => `
    <tr><th scope="row">${esc(t.title)}</th>
      ${C.LEVELS.map(lv => { const s = C.topicLevelStats(st, t.id, lv); return `<td>${pct(s.acc)}${s.total ? `<small>${s.total} resp.</small>` : ''}</td>`; }).join('')}
    </tr>`).join('');

  const sessions = st.sessions.filter(s => s.answers.length).slice(-40).reverse().map(s => {
    const c = s.answers.filter(a => a.ok).length;
    const label = s.mode === 'review' ? 'Revisão do dia' : s.mode === 'retry' ? `Refazer erros · ${esc(topicById(s.topic)?.title || 'Vários')}` : esc(topicById(s.topic)?.title || '');
    const lv = s.level ? ` · ${LEVEL_NAMES[s.level]}` : s.mode === 'topic' ? ' · Misto' : '';
    return `<li><span><b>${label}</b>${lv}<br><small>${new Date(s.ts).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</small></span><span class="sess-score">${c}/${s.answers.length}</span></li>`;
  }).join('');

  $main().innerHTML = `
    <header class="page-head"><h1>Sua evolução</h1></header>
    <div class="stats">
      <div class="stat"><span class="stat-n">${all.length}</span><span class="stat-l">respostas no total</span></div>
      <div class="stat"><span class="stat-n">${pct(m30.acc)}</span><span class="stat-l">acerto em 30 dias</span></div>
      <div class="stat"><span class="stat-n">${C.streak(st, now)}</span><span class="stat-l">dias seguidos</span></div>
    </div>
    <section class="card">
      <h2 class="card-title">Últimos 30 dias</h2>
      <svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Respostas por dia nos últimos 30 dias">${bars}</svg>
      <p class="legend"><span class="key key-ok"></span>certas <span class="key key-total"></span>erradas</p>
    </section>
    <section class="card">
      <h2 class="card-title">Acerto recente por tema</h2>
      <p class="hint">Últimas 20 respostas de cada nível · total respondido</p>
      <div class="table-wrap"><table class="grid">
        <thead><tr><th></th>${C.LEVELS.map(lv => `<th>${LEVEL_NAMES[lv]}</th>`).join('')}</tr></thead>
        <tbody>${table}</tbody>
      </table></div>
    </section>
    <section class="card">
      <h2 class="card-title">Sessões</h2>
      ${sessions ? `<ul class="sessions">${sessions}</ul>` : '<p class="hint">Nenhuma sessão ainda. Comece por um tema na tela inicial.</p>'}
    </section>`;
}

/* ---------- Ajustes ---------- */

function renderSettings() {
  const answers = C.allAnswers(app.state).length;
  $main().innerHTML = `
    <header class="page-head"><h1>Ajustes</h1></header>
    <section class="card">
      <h2 class="card-title">Backup do progresso</h2>
      <p class="hint">Seu histórico fica salvo só neste aparelho. Exporte um backup de vez em quando, principalmente antes de trocar de celular.</p>
      <div class="actions stack">
        <button class="btn wide" id="export">Exportar backup</button>
        <label class="btn btn-ghost wide" for="import-file">Importar backup</label>
        <input type="file" id="import-file" accept="application/json,.json" hidden>
      </div>
    </section>
    <section class="card">
      <h2 class="card-title">Sobre</h2>
      <p class="hint">Versão ${C.APP_VERSION} · ${app.items.length} exercícios · ${answers} respostas registradas</p>
      <div class="actions stack"><button class="btn btn-ghost wide" id="update">Verificar atualização</button></div>
    </section>
    <section class="card danger">
      <h2 class="card-title">Zerar progresso</h2>
      <p class="hint">Apaga todo o histórico deste aparelho. Não dá para desfazer.</p>
      <button class="btn btn-danger wide" id="reset">Zerar tudo</button>
    </section>`;

  document.getElementById('export').addEventListener('click', exportBackup);
  document.getElementById('import-file').addEventListener('change', importBackup);
  document.getElementById('reset').addEventListener('click', () => {
    if (!confirm('Apagar todo o progresso? Isso não pode ser desfeito.')) return;
    if (!confirm('Tem certeza? Recomendo exportar um backup antes.')) return;
    clearState(); app.state = C.emptyState(); persist(); toast('Progresso zerado.'); renderSettings();
  });
  document.getElementById('update').addEventListener('click', checkUpdate);
}

async function exportBackup() {
  const data = C.makeBackup(app.state);
  const name = `trilha-ingles-backup-${C.dayKey(Date.now())}.json`;
  const file = new File([data], name, { type: 'application/json' });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Backup Trilha de Inglês' });
      return;
    }
  } catch (e) { if (e && e.name === 'AbortError') return; }
  const url = URL.createObjectURL(file);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  toast('Backup exportado.');
}

async function importBackup(e) {
  const f = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try {
    const next = C.parseBackup(await f.text());
    const n = C.allAnswers(next).length;
    if (!confirm(`Substituir o progresso atual por este backup (${n} respostas)?`)) return;
    app.state = next; persist(); toast('Backup importado.'); renderSettings();
  } catch (err) { toast(err.message); }
}

/* ---------- PWA ---------- */

let waitingWorker = null;
function registerSW() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  navigator.serviceWorker.register('sw.js').then(reg => {
    const onWaiting = w => { waitingWorker = w; showUpdateBanner(); };
    if (reg.waiting) onWaiting(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const nw = reg.installing;
      nw && nw.addEventListener('statechange', () => {
        if (nw.state === 'installed' && navigator.serviceWorker.controller) onWaiting(nw);
      });
    });
  }).catch(err => console.warn('Service worker não registrado', err));
  // Recarrega só quando o usuário pediu a atualização (não na primeira instalação).
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (updateRequested) { updateRequested = false; location.reload(); }
  });
}
let updateRequested = false;

function showUpdateBanner() {
  const b = document.getElementById('update-banner');
  b.hidden = false;
  b.querySelector('button').onclick = () => {
    if (app.session && !confirm('Atualizar agora encerra a sessão atual (as respostas já estão salvas). Continuar?')) return;
    if (!waitingWorker) return;
    updateRequested = true;
    waitingWorker.postMessage('skipWaiting');
  };
}

async function checkUpdate() {
  if (!('serviceWorker' in navigator)) { toast('Atualização automática indisponível neste navegador.'); return; }
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) { toast('App ainda não instalado.'); return; }
  await reg.update();
  setTimeout(() => toast(waitingWorker ? 'Nova versão disponível: toque em Atualizar no topo.' : 'Você já está na versão mais recente.'), 800);
}

/* ---------- Utilidades de interface ---------- */

let toastTimer;
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3500);
}

init();
