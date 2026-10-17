import * as C from './core.js';
import { loadState, saveState, clearState, requestPersistence } from './storage.js';

const TYPE_LABEL = { mcq: 'Escolha a opção', fix: 'Escolha a versão correta', gap: 'Complete a lacuna', order: 'Ordene a frase' };
const STATUS_LABEL = { consolidado: 'Consolidado', em_progresso: 'Em progresso', poucos_dados: 'Poucos dados', sem_conteudo: 'Ainda não disponível' };
const SESSION_SIZE = 10;
const MIN_FOR_REINFORCE = 20;

const app = {
  state: C.emptyState(),
  groups: [],
  allTopics: [],   // todos os temas, inclusive os de lotes fechados
  allItems: [],
  topics: [],      // temas liberados: [{group, groupTitle, color, ...topic}]
  items: [],       // exercícios liberados (tudo no app usa só estes)
  gates: [],       // ids dos grupos fechados, na ordem de liberação
  byId: new Map(),
  session: null,   // sessão em andamento (somente memória)
};

const $main = () => document.getElementById('main');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = v => (v == null ? '—' : `${Math.round(v * 100)}%`);
const topicById = id => app.topics.find(t => t.id === id);
const skillMeta = (topic, skill) => {
  const t = topicById(topic);
  const s = t && t.skills.find(x => x.id === skill);
  return { topicTitle: t ? t.title : topic, skillTitle: s ? s.title : skill, tip: s ? s.tip : '', ex: s ? s.ex : '', color: t ? t.color : null };
};
const cefrRange = t => { const u = [...new Set(t.cefr)]; return u.length === 1 ? u[0] : `${u[0]}–${u[u.length - 1]}`; };

/* ---------- Inicialização ---------- */

async function init() {
  app.state = loadState();
  try {
    const topicsData = await fetchJSON('data/topics.json');
    app.groups = topicsData.groups;
    app.gates = app.groups.filter(g => g.locked).map(g => g.id);
    app.allTopics = topicsData.groups.flatMap(g => g.topics.map(t => ({ ...t, group: g.id, groupTitle: g.title, color: g.color })));
    const banks = await Promise.all(app.allTopics.map(t => fetchJSON(`data/${t.id}.json`).catch(() => ({ items: [] }))));
    for (const b of banks) {
      for (const it of b.items || []) {
        const errs = C.validateItem(it);
        if (errs.length) { console.warn('Item ignorado', it && it.id, errs); continue; }
        if (app.byId.has(it.id)) continue;
        app.allItems.push(it);
        app.byId.set(it.id, it);
      }
    }
    applyActive();
    maybeUnlock();
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

const groupOpen = g => !g.locked || C.isUnlocked(app.state, g.id);

function applyActive() {
  const open = new Set(app.groups.filter(groupOpen).map(g => g.id));
  app.topics = app.allTopics.filter(t => open.has(t.group));
  const ids = new Set(app.topics.map(t => t.id));
  app.items = app.allItems.filter(i => ids.has(i.topic));
}

// Liberação silenciosa: avalia em segundo plano e abre no máximo um lote por vez.
function maybeUnlock() {
  const g = C.unlockCheck(app.items, app.state, app.gates);
  if (!g) return null;
  app.state.unlocked[g] = Date.now();
  persist();
  applyActive();
  return app.groups.find(x => x.id === g);
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
  if (page === 'reinforce') return renderReinforce();
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
  const lvl = C.levelEstimate(app.items, st);

  const fresh = app.groups.filter(g => g.locked && C.isUnlocked(st, g.id) && !st.announced.includes(g.id));
  const news = fresh.map(g => `<section class="unlock-card" style="--g:${esc(g.color)}">
      <p class="eyebrow">Novo lote liberado</p>
      <h2>${esc(g.title)}</h2>
      <p>${g.topics.length} temas novos: ${esc(g.topics.map(t => t.title).join(' · '))}.</p>
      <button class="btn" data-ack="${esc(g.id)}">Ver os temas</button>
    </section>`).join('');

  const groups = app.groups.map(g => {
    if (!groupOpen(g)) {
      return `<section class="group group-soon" style="--g:${esc(g.color)}">
        <div class="group-head"><h2><span class="gdot" aria-hidden="true"></span>${esc(g.title)}</h2><span class="pill">${esc(g.level)}</span></div>
        <div class="soon"><span class="soon-tag">Fechado</span><span>${esc(g.topics.map(t => t.title).join(' · '))}</span></div>
      </section>`;
    }
    return `<section class="group" id="g-${esc(g.id)}" style="--g:${esc(g.color)}">
      <div class="group-head"><h2><span class="gdot" aria-hidden="true"></span>${esc(g.title)}</h2><span class="pill">${esc(g.level)}</span></div>
      <div class="topic-list">${g.topics.map(t => topicCard(t.id)).join('')}</div>
    </section>`;
  }).join('');

  $main().innerHTML = `
    <header class="page-head">
      <p class="eyebrow">Trilha de Inglês · ${lvl.estimate ? `nível estimado ${lvl.estimate}` : 'nível em avaliação'}</p>
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
    ${news}
    ${groups}
    <p class="foot-note">${app.items.length} exercícios · ${app.topics.length} temas</p>`;

  $main().querySelectorAll('[data-ack]').forEach(b => b.addEventListener('click', () => {
    const id = b.dataset.ack;
    if (!app.state.announced.includes(id)) app.state.announced.push(id);
    persist();
    renderHome();
    const sec = document.getElementById(`g-${id}`);
    if (sec) sec.scrollIntoView({ block: 'start' });
  }));

  const rb = document.getElementById('review-btn');
  if (due) rb.addEventListener('click', () => startSession({ mode: 'review', label: 'Revisão do dia' }));
}

function topicCard(id) {
  const t = topicById(id);
  const s = C.topicLevelStats(app.state, id, null, 30);
  const cov = C.coverage(app.items, app.state, id);
  const pc = cov.total ? Math.round((cov.seen / cov.total) * 100) : 0;
  const cls = s.acc == null ? '' : s.acc >= 0.8 ? 'good' : s.acc >= 0.6 ? 'mid' : 'low';
  return `<a class="topic" href="#/topic/${t.id}">
      <span class="topic-top"><span class="topic-title">${esc(t.title)}</span><span class="cefr">${cefrRange(t)}</span></span>
      <span class="topic-short">${esc(t.short)}</span>
      <span class="topic-meta"><span class="acc ${cls}">Acerto ${pct(s.acc)}</span><span>${cov.seen}/${cov.total} vistos</span></span>
      <span class="meter" aria-hidden="true"><span class="gfill" style="width:${pc}%"></span></span>
    </a>`;
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
}

/* ---------- Tema ---------- */

function renderTopic(id) {
  const t = topicById(id);
  const s = C.topicLevelStats(app.state, id, null, 30);
  const cov = C.coverage(app.items, app.state, id);
  const sk = new Map(C.skillStats(app.items, app.state).filter(x => x.topic === id).map(x => [x.skill, x]));

  const skills = t.skills.map(k => {
    const st = sk.get(k.id);
    const n = app.items.filter(i => i.topic === id && i.skill === k.id).length;
    const cls = !st || st.acc == null ? '' : st.acc >= 0.8 ? 'good' : st.acc >= 0.6 ? 'mid' : 'low';
    return `<details class="skill">
        <summary><span>${esc(k.title)}</span>${st ? `<span class="acc ${cls}">${pct(st.acc)}</span>` : ''}</summary>
        <p class="skill-tip">${esc(k.tip)}</p>
        <p class="skill-ex">${esc(k.ex)}</p>
        ${n >= 2 ? `<button class="btn btn-ghost btn-small" data-skill="${esc(k.id)}">Treinar só este ponto · ${Math.min(n, SESSION_SIZE)}</button>` : ''}
      </details>`;
  }).join('');

  $main().innerHTML = `
    <a class="back" href="#/">← Início</a>
    <header class="page-head" style="--g:${esc(t.color)}">
      <p class="eyebrow"><span class="gdot" aria-hidden="true"></span>${esc(t.groupTitle)} · ${cefrRange(t)}</p>
      <h1>${esc(t.title)}</h1>
      <p class="lead">${esc(t.intro)}</p>
    </header>
    <div class="stats">
      <div class="stat"><span class="stat-n">${pct(s.acc)}</span><span class="stat-l">acerto recente</span></div>
      <div class="stat"><span class="stat-n">${cov.seen}<small>/${cov.total}</small></span><span class="stat-l">exercícios vistos</span></div>
      <div class="stat"><span class="stat-n">${s.total}</span><span class="stat-l">respostas</span></div>
    </div>
    <button class="btn wide btn-big" id="practice">Praticar · ${SESSION_SIZE} exercícios mistos</button>
    <p class="hint center">Fácil, médio e difícil misturados, com prioridade para o que você errou.</p>
    <h2 class="section-title">O que este tema cobre</h2>
    <div class="skills">${skills}</div>`;

  document.getElementById('practice').addEventListener('click', () => startSession({ topic: id, label: t.title }));
  $main().querySelectorAll('[data-skill]').forEach(b => b.addEventListener('click', () => {
    const m = skillMeta(id, b.dataset.skill);
    startSession({ mode: 'skill', topic: id, skills: [`${id}:${b.dataset.skill}`], label: `Treino: ${m.skillTitle}`, backHash: `#/topic/${id}` });
  }));
}

/* ---------- Sessão ---------- */

function startSession({ topic = null, mode = 'topic', ids = null, skills = null, queue = null, label = '', backHash = null }) {
  const q = queue || C.buildSession(app.items, app.state, { topic, mode, ids, skills, size: SESSION_SIZE });
  if (!q.length) { toast('Não há exercícios para esta seleção.'); return; }
  app.session = {
    record: { id: `s${Date.now()}`, ts: Date.now(), mode, topic, level: null, label, answers: [] },
    params: { topic, mode, skills, label, backHash },
    queue: q, index: 0, answered: false, response: null, results: [],
    backHash: backHash || (topic ? `#/topic/${topic}` : mode === 'reinforce' || mode === 'general' ? '#/reinforce' : '#/'),
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
  const m = skillMeta(it.topic, it.skill);
  const progress = Math.round((s.index / s.queue.length) * 100);

  $main().innerHTML = `
    <div class="session-top">
      <button class="icon-btn" id="quit" aria-label="Encerrar sessão">✕</button>
      <div class="bar" role="progressbar" aria-valuenow="${s.index}" aria-valuemax="${s.queue.length}"><span style="width:${progress}%"></span></div>
      <span class="count">${s.index + 1}/${s.queue.length}</span>
    </div>
    <div class="q-meta"><span>${esc(t ? t.title : '')} · ${esc(it.cefr)}</span><button class="link-btn" id="hint-btn" aria-expanded="false">Dica da regra</button></div>
    <div class="hint-box" id="hint-box" hidden><b>${esc(m.skillTitle)}</b><br>${esc(m.tip)}</div>
    <section class="q card">
      <p class="q-type">${TYPE_LABEL[it.type]}</p>
      <div id="q-body">${questionBody(it)}</div>
    </section>
    <div id="feedback" aria-live="polite"></div>
    <div class="actions"><button class="btn wide" id="check" disabled>Verificar</button></div>`;

  document.getElementById('quit').addEventListener('click', quitSession);
  document.getElementById('hint-btn').addEventListener('click', e => {
    const box = document.getElementById('hint-box');
    box.hidden = !box.hidden;
    e.currentTarget.setAttribute('aria-expanded', String(!box.hidden));
  });
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
  document.getElementById('hint-box').hidden = true;

  const m = skillMeta(it.topic, it.skill);
  const last = s.index === s.queue.length - 1;
  document.getElementById('feedback').innerHTML = `
    <div class="fb ${ok ? 'fb-ok' : 'fb-bad'}">
      <p class="fb-title">${ok ? 'Correto!' : 'Não foi dessa vez.'}</p>
      ${ok ? '' : `<p class="fb-answer">Resposta: <b>${esc(C.correctAnswerText(it))}</b></p>`}
      <p class="fb-explain">${esc(it.explain)}</p>
    </div>
    ${ok ? '' : `<div class="reforco"><p class="reforco-title">Reforço · ${esc(m.skillTitle)}</p><p>${esc(m.tip)}</p><p class="skill-ex">${esc(m.ex)}</p></div>`}`;
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
  const opened = maybeUnlock();
  if (opened) toast(`Novo lote liberado: ${opened.title}`);
  const correct = s.results.filter(r => r.ok).length;
  const wrong = s.results.filter(r => !r.ok).map(r => app.byId.get(r.id));
  const ratio = correct / s.results.length;
  const msg = ratio === 1 ? 'Perfeito!' : ratio >= 0.8 ? 'Muito bom.' : ratio >= 0.6 ? 'Bom caminho.' : 'Vale rever os pontos abaixo e treinar de novo.';

  // Agrupa os erros por padrão, com o reforço da regra uma única vez.
  const groups = new Map();
  for (const w of wrong) {
    const k = `${w.topic}:${w.skill}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(w);
  }
  const review = [...groups.entries()].map(([k, list]) => {
    const [topic, skill] = k.split(':');
    const m = skillMeta(topic, skill);
    return `<section class="card review-group">
        <p class="eyebrow">${esc(m.topicTitle)}</p>
        <h3>${esc(m.skillTitle)}</h3>
        <div class="reforco"><p>${esc(m.tip)}</p><p class="skill-ex">${esc(m.ex)}</p></div>
        ${list.map(w => `<div class="wrong-item">
          <p class="wi-q">${w.type === 'order' ? 'Ordenação' : esc(w.prompt)}</p>
          <p class="wi-a">${esc(C.correctAnswerText(w))}</p>
        </div>`).join('')}
      </section>`;
  }).join('');
  const wrongIds = wrong.map(w => w.id);
  const skillKeys = [...groups.keys()];

  $main().innerHTML = `
    <section class="summary card">
      <p class="eyebrow">Sessão concluída</p>
      <p class="score">${correct}<span>/${s.results.length}</span></p>
      <p class="lead">${msg}</p>
    </section>
    ${wrong.length ? `<h2 class="section-title">Reforço dos pontos que você errou</h2>${review}` : ''}
    <div class="actions stack">
      ${wrong.length ? '<button class="btn wide" id="drill">Treinar estes pontos</button>' : ''}
      ${wrong.length ? '<button class="btn btn-ghost wide" id="retry">Refazer só os que errei</button>' : ''}
      <button class="btn ${wrong.length ? 'btn-ghost' : ''} wide" id="again">Nova sessão</button>
      <a class="btn btn-ghost wide" href="${s.backHash}">Voltar</a>
    </div>`;

  const p = s.params;
  document.getElementById('again').addEventListener('click', () => {
    if (p.mode === 'reinforce') return startReinforce();
    startSession({ ...p });
  });
  const retry = document.getElementById('retry');
  if (retry) retry.addEventListener('click', () => startSession({ mode: 'retry', ids: wrongIds, label: 'Refazer erros', backHash: s.backHash }));
  const drill = document.getElementById('drill');
  if (drill) drill.addEventListener('click', () => startSession({ mode: 'skill', skills: skillKeys, label: 'Treino dos erros', backHash: s.backHash }));
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

/* ---------- Reforçar ---------- */

function startReinforce() {
  const { queue, focus } = C.buildReinforce(app.items, app.state, { size: SESSION_SIZE });
  startSession({ mode: focus.length ? 'reinforce' : 'general', queue, label: focus.length ? 'Reforço' : 'Treino geral', backHash: '#/reinforce' });
}

function renderReinforce() {
  const st = app.state;
  const total = C.allAnswers(st).length;

  if (total < MIN_FOR_REINFORCE) {
    $main().innerHTML = `
      <header class="page-head"><h1>Reforçar</h1><p class="lead">Aqui o app analisa seus erros e monta treinos focados nos seus pontos fracos.</p></header>
      <section class="card">
        <h2 class="card-title">Ainda estou conhecendo você</h2>
        <p class="hint">Responda pelo menos ${MIN_FOR_REINFORCE} exercícios para eu identificar seus padrões de erro.</p>
        <div class="meter big" aria-hidden="true"><span class="fill" style="width:${Math.round((total / MIN_FOR_REINFORCE) * 100)}%"></span></div>
        <p class="hint">${total} de ${MIN_FOR_REINFORCE}</p>
        <button class="btn wide" id="general">Treino geral · ${SESSION_SIZE} exercícios</button>
      </section>`;
    document.getElementById('general').addEventListener('click', () => startSession({ mode: 'general', label: 'Treino geral', backHash: '#/reinforce' }));
    return;
  }

  const weak = C.weakSkills(app.items, st, { min: 3, limit: 6 });
  const focus = weak.filter(w => w.score > 0.25).slice(0, 3);
  const topics = C.topicRanking(app.items, st, app.topics.map(t => t.id));

  const weakRows = weak.map(w => {
    const m = skillMeta(w.topic, w.skill);
    const cls = w.acc >= 0.8 ? 'good' : w.acc >= 0.6 ? 'mid' : 'low';
    return `<details class="skill weak">
        <summary>
          <span class="weak-main"><span class="weak-title">${esc(m.skillTitle)}</span><span class="weak-topic">${esc(m.topicTitle)}</span></span>
          <span class="acc ${cls}">${pct(w.acc)}<small> ${w.correct}/${w.n}</small></span>
        </summary>
        <p class="skill-tip">${esc(m.tip)}</p>
        <p class="skill-ex">${esc(m.ex)}</p>
        <button class="btn btn-ghost btn-small" data-key="${esc(w.key)}">Treinar este ponto</button>
      </details>`;
  }).join('');

  const topicRows = topics.map(t => {
    const meta = topicById(t.topic);
    const cls = t.acc >= 0.8 ? 'good' : t.acc >= 0.6 ? 'mid' : 'low';
    return `<a class="rank-row" href="#/topic/${t.topic}" style="--g:${esc(meta.color)}">
        <span class="rank-title">${esc(meta.title)}</span>
        <span class="meter" aria-hidden="true"><span class="gfill" style="width:${Math.round(t.acc * 100)}%"></span></span>
        <span class="acc ${cls}">${pct(t.acc)}</span>
      </a>`;
  }).join('');

  $main().innerHTML = `
    <header class="page-head"><h1>Reforçar</h1><p class="lead">Com base nas suas últimas respostas em cada padrão gramatical.</p></header>
    ${focus.length ? `
    <section class="focus-card">
      <p class="eyebrow">Sessão de reforço</p>
      <p class="focus-title">${SESSION_SIZE} exercícios nos seus ${focus.length === 1 ? 'ponto mais fraco' : `${focus.length} pontos mais fracos`}</p>
      <ul>${focus.map(f => `<li>${esc(skillMeta(f.topic, f.skill).skillTitle)} <small>${pct(f.acc)}</small></li>`).join('')}</ul>
      <button class="btn wide btn-invert" id="reinforce">Começar reforço</button>
    </section>` : `
    <section class="card">
      <h2 class="card-title">Nenhum ponto fraco claro agora</h2>
      <p class="hint">Todos os padrões que você praticou estão com bom acerto. Siga para temas novos ou faça um treino geral.</p>
      <button class="btn wide" id="reinforce">Treino geral · ${SESSION_SIZE} exercícios</button>
    </section>`}
    ${weak.length ? `<h2 class="section-title">Seus padrões de erro</h2><p class="hint">Toque para ver a regra e treinar só aquele ponto.</p><div class="skills">${weakRows}</div>` : ''}
    ${topics.length ? `<h2 class="section-title">Temas do pior para o melhor</h2><section class="card rank">${topicRows}</section>` : ''}
    <section class="card">
      <h2 class="card-title">Exercícios novos sob medida</h2>
      <p class="hint">Copie o relatório dos seus erros e cole numa conversa com o Claude. Ele cria um lote novo de exercícios focado nesses padrões, revisado e testado, que entra numa próxima versão do app.</p>
      <button class="btn btn-ghost wide" id="report">Copiar relatório de erros</button>
      <textarea id="report-text" class="report" readonly hidden aria-label="Relatório de erros"></textarea>
    </section>`;

  document.getElementById('reinforce').addEventListener('click', startReinforce);
  $main().querySelectorAll('[data-key]').forEach(b => b.addEventListener('click', () => {
    const [topic, skill] = b.dataset.key.split(':');
    startSession({ mode: 'skill', topic, skills: [b.dataset.key], label: `Treino: ${skillMeta(topic, skill).skillTitle}`, backHash: '#/reinforce' });
  }));
  document.getElementById('report').addEventListener('click', copyReport);
}

async function copyReport() {
  const text = C.errorReport(app.items, app.state, skillMeta);
  const ta = document.getElementById('report-text');
  ta.value = text;
  try {
    await navigator.clipboard.writeText(text);
    toast('Relatório copiado. Cole numa conversa com o Claude.');
  } catch {
    ta.hidden = false; ta.focus(); ta.select();
    toast('Não consegui copiar sozinho: selecione o texto abaixo e copie.');
  }
}

/* ---------- Evolução ---------- */

function renderHistory() {
  const now = Date.now();
  const st = app.state;
  const lvl = C.levelEstimate(app.items, st);
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

  const ladder = lvl.bands.slice().reverse().map(b => {
    const isMe = b.band === lvl.estimate;
    const width = b.acc == null ? 0 : Math.round(b.acc * 100);
    const detail = b.status === 'sem_conteudo' ? 'sem exercícios disponíveis no momento'
      : b.status === 'poucos_dados' ? `${b.n} de ${C.LEVEL_RULES.minData} respostas mínimas`
      : `${pct(b.acc)} nas últimas ${b.n}`;
    return `<li class="rung st-${b.status} ${isMe ? 'is-me' : ''}">
        <span class="rung-band">${b.band}</span>
        <span class="rung-body">
          <span class="rung-top"><b>${STATUS_LABEL[b.status]}</b>${isMe ? '<span class="pill pill-accent">você está aqui</span>' : ''}</span>
          <span class="meter" aria-hidden="true"><span class="fill" style="width:${width}%"></span><span class="target"></span></span>
          <span class="rung-detail">${detail}</span>
        </span>
      </li>`;
  }).join('');

  let nextTxt = '';
  if (lvl.next && lvl.next.status !== 'sem_conteudo') {
    const need = Math.max(0, C.LEVEL_RULES.minSolid - lvl.next.n);
    nextTxt = `Para consolidar <b>${lvl.next.band}</b>: ${C.LEVEL_RULES.solidAcc * 100}% de acerto em pelo menos ${C.LEVEL_RULES.minSolid} respostas dessa faixa${lvl.next.n ? ` (hoje: ${pct(lvl.next.acc)} em ${lvl.next.n}${need ? `, faltam ${need} respostas` : ''})` : ''}.`;
  }

  const table = app.topics.map(t => {
    const s = C.topicLevelStats(st, t.id, null, 30);
    const cov = C.coverage(app.items, st, t.id);
    return `<tr><th scope="row">${esc(t.title)}</th><td>${pct(s.acc)}</td><td>${cov.seen}/${cov.total}</td></tr>`;
  }).join('');

  const sessions = st.sessions.filter(s => s.answers.length).slice(-40).reverse().map(s => {
    const c = s.answers.filter(a => a.ok).length;
    return `<li><span><b>${esc(sessionLabel(s))}</b><br><small>${new Date(s.ts).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</small></span><span class="sess-score">${c}/${s.answers.length}</span></li>`;
  }).join('');

  $main().innerHTML = `
    <header class="page-head"><h1>Sua evolução</h1></header>
    <section class="card level-card">
      <p class="eyebrow">Nível estimado</p>
      <p class="level-big ${lvl.estimate ? '' : 'is-pending'}">${lvl.estimate || 'Em avaliação'}</p>
      <p class="hint">${lvl.estimate ? 'Faixa mais alta consolidada, sem pontos fracos graves abaixo dela.' : 'Pratique os temas, incluindo a Revisão de base, para o app conseguir estimar seu nível.'}</p>
      <ol class="ladder">${ladder}</ol>
      ${nextTxt ? `<p class="next-goal">${nextTxt}</p>` : ''}
      <p class="caveat">Estimativa com base nos exercícios do app: mede gramática e vocabulário, não fala nem compreensão auditiva, e não substitui um teste oficial.</p>
    </section>
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
      <h2 class="card-title">Acerto por tema</h2>
      <p class="hint">Últimas 30 respostas de cada tema</p>
      <div class="table-wrap"><table class="grid">
        <thead><tr><th></th><th>Acerto</th><th>Vistos</th></tr></thead>
        <tbody>${table}</tbody>
      </table></div>
    </section>
    <section class="card">
      <h2 class="card-title">Sessões</h2>
      ${sessions ? `<ul class="sessions">${sessions}</ul>` : '<p class="hint">Nenhuma sessão ainda. Comece por um tema na tela inicial.</p>'}
    </section>`;
}

function sessionLabel(s) {
  if (s.label) return s.label;
  if (s.mode === 'review') return 'Revisão do dia';
  if (s.mode === 'retry') return 'Refazer erros';
  if (s.mode === 'reinforce') return 'Reforço';
  if (s.mode === 'general') return 'Treino geral';
  return topicById(s.topic)?.title || 'Sessão';
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
    clearState(); app.state = C.emptyState(); persist(); applyActive(); toast('Progresso zerado.'); renderSettings();
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
    app.state = next; persist(); applyActive(); maybeUnlock(); toast('Backup importado.'); renderSettings();
  } catch (err) { toast(err.message); }
}

/* ---------- PWA ---------- */

let waitingWorker = null;
let updateRequested = false;
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
