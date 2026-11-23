import { API_URL } from './config.js';

const TOKEN_KEY = 'latin.token';
const $ = (sel) => document.querySelector(sel);

const ERRORS = {
  invalid_username: 'Логин: 3–20 символов, латиница, цифры и _, начинается с буквы.',
  invalid_password: 'Пароль: от 8 до 128 символов, не совпадает с логином.',
  username_taken: 'Этот логин занят. Выберите другой.',
  invalid_credentials: 'Неверный логин или пароль.',
  too_many_attempts: 'Слишком много попыток входа. Подождите 15 минут.',
  account_blocked: 'Аккаунт заблокирован. Обратитесь к администратору.',
  unauthorized: 'Сессия истекла. Войдите снова.',
  busy: 'Сервер занят. Повторите через несколько секунд.',
  network: 'Нет связи с сервером. Проверьте интернет и повторите.',
  server_error: 'Ошибка сервера. Повторите позже.',
  forbidden: 'Недостаточно прав.',
  unknown_action: 'Ошибка приложения. Обновите страницу.'
};

const ROLE_NAMES = { user: 'Ученик', super_admin: 'Владелец' };

let state = { token: null, user: null, forcedChange: false };

/* ---------- API ---------- */

class ApiError extends Error {
  constructor(code) { super(code); this.code = code; }
}

async function api(action, payload = {}, { auth = true } = {}) {
  const body = { action, ...payload };
  if (auth) body.token = state.token;
  let res;
  try {
    // text/plain, чтобы браузер не делал CORS-preflight (Apps Script его не поддерживает)
    res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body)
    });
  } catch {
    throw new ApiError('network');
  }
  let json;
  try { json = await res.json(); } catch { throw new ApiError('server_error'); }
  if (!json.ok) throw new ApiError(json.error || 'server_error');
  return json.data;
}

/* ---------- Экраны ---------- */

const views = ['auth', 'home', 'change', 'dict', 'mine', 'train', 'profile'];

function show(name) {
  $('#boot').hidden = true;
  views.forEach((v) => { $('#view-' + v).hidden = v !== name; });
  const target = $('#view-' + name);
  target.classList.remove('view-in'); void target.offsetWidth; target.classList.add('view-in');
  const withNav = ['home', 'dict', 'mine', 'profile'].includes(name);
  document.getElementById('menu-btn').hidden = !withNav;
  if (!withNav) { document.getElementById('menu').hidden = true; document.getElementById('menu-btn').setAttribute('aria-expanded', 'false'); }
  $('#nav').hidden = !withNav;
  document.body.classList.toggle('has-nav', withNav);
  document.querySelectorAll('#nav button').forEach((b) => {
    if (b.dataset.go === name) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  window.scrollTo(0, 0);
}

function toast(text, ok = false) {
  const el = $('#toast');
  el.textContent = text;
  el.className = 'toast' + (ok ? ' ok' : '');
  el.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { el.hidden = true; }, 3500);
}

function formError(form, message) {
  const p = form.querySelector('.form-error');
  p.textContent = message || '';
  p.hidden = !message;
}

function setBusy(form, busy) {
  form.querySelectorAll('button').forEach((b) => { b.disabled = busy; });
}

function renderHome() {
  const u = state.user;
  $('#home-title').textContent = 'Здравствуйте, ' + u.username;
  $('#home-level').textContent = String(u.level);
  $('#home-xp').textContent = String(u.xp);
  $('#home-role').textContent = ROLE_NAMES[u.role] || 'Ученик';
  show('home');
  loadStats();
}

function openChange(forced) {
  state.forcedChange = forced;
  $('#change-note').hidden = !forced;
  $('#btn-change-cancel').hidden = forced;
  $('#form-change').reset();
  formError($('#form-change'), '');
  show('change');
}

function enter(user) {
  state.user = user;
  if (user.must_change_password) openChange(true);
  else renderHome();
}

function saveSession(data) {
  state.token = data.token;
  localStorage.setItem(TOKEN_KEY, data.token);
  enter(data.user);
}

function clearSession() {
  if (typeof lists !== 'undefined') { lists.dict.loaded = false; lists.mine.loaded = false; }
  state = { token: null, user: null, forcedChange: false };
  localStorage.removeItem(TOKEN_KEY);
}

/* ---------- Проверка ввода (зеркалит правила сервера) ---------- */

function checkCredentials(username, password) {
  if (!/^[A-Za-z][A-Za-z0-9_]{2,19}$/.test(username)) return 'invalid_username';
  if (password.length < 8 || password.length > 128) return 'invalid_password';
  if (password.toLowerCase() === username.toLowerCase()) return 'invalid_password';
  return '';
}

/* ---------- Обработчики ---------- */

function selectTab(name) {
  const login = name === 'login';
  $('#tab-login').setAttribute('aria-selected', String(login));
  $('#tab-register').setAttribute('aria-selected', String(!login));
  $('#form-login').hidden = !login;
  $('#form-register').hidden = login;
  const f = login ? $('#form-login') : $('#form-register');
  f.classList.remove('swap'); void f.offsetWidth; f.classList.add('swap');
  formError($('#form-login'), '');
  formError($('#form-register'), '');
}

$('#tab-login').addEventListener('click', () => selectTab('login'));
$('#tab-register').addEventListener('click', () => selectTab('register'));

$('#form-login').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  const username = form.username.value.trim();
  const password = form.password.value;
  if (!username || !password) return formError(form, 'Введите логин и пароль.');
  formError(form, '');
  setBusy(form, true);
  try {
    saveSession(await api('login', { username, password }, { auth: false }));
    form.reset();
  } catch (err) {
    formError(form, ERRORS[err.code] || ERRORS.server_error);
  } finally {
    setBusy(form, false);
  }
});

$('#form-register').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  const username = form.username.value.trim();
  const password = form.password.value;
  const bad = checkCredentials(username, password);
  if (bad) return formError(form, ERRORS[bad]);
  if (password !== form.password2.value) return formError(form, 'Пароли не совпадают.');
  formError(form, '');
  setBusy(form, true);
  try {
    saveSession(await api('register', { username, password }, { auth: false }));
    form.reset();
    toast('Аккаунт создан', true);
  } catch (err) {
    formError(form, ERRORS[err.code] || ERRORS.server_error);
  } finally {
    setBusy(form, false);
  }
});

$('#btn-logout').addEventListener('click', async () => {
  try { await api('logout'); } catch { /* сессия всё равно сбрасывается локально */ }
  clearSession();
  selectTab('login');
  show('auth');
});

$('#btn-to-change').addEventListener('click', () => openChange(false));
$('#btn-change-cancel').addEventListener('click', () => renderHome());

$('#form-change').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  const currentPassword = form.currentPassword.value;
  const newPassword = form.newPassword.value;
  const bad = checkCredentials(state.user.username, newPassword);
  if (bad) return formError(form, ERRORS[bad]);
  if (newPassword !== form.newPassword2.value) return formError(form, 'Новые пароли не совпадают.');
  formError(form, '');
  setBusy(form, true);
  try {
    const data = await api('changePassword', { currentPassword, newPassword });
    state.token = data.token;
    localStorage.setItem(TOKEN_KEY, data.token);
    state.user = data.user;
    renderHome();
    toast('Пароль изменён', true);
  } catch (err) {
    if (err.code === 'unauthorized') {
      clearSession();
      show('auth');
      toast(ERRORS.unauthorized);
    } else {
      formError(form, err.code === 'invalid_credentials' ? 'Текущий пароль неверен.' : (ERRORS[err.code] || ERRORS.server_error));
    }
  } finally {
    setBusy(form, false);
  }
});

/* ---------- Запуск ---------- */

async function init() {
  const saved = localStorage.getItem(TOKEN_KEY);
  if (!saved) return show('auth');
  state.token = saved;
  try {
    enter(await api('me'));
  } catch (err) {
    if (err.code === 'network') {
      // Нет сети: токен не сбрасываем, просим повторить
      show('auth');
      toast(ERRORS.network);
    } else {
      clearSession();
      show('auth');
      if (err.code === 'unauthorized') toast(ERRORS.unauthorized);
    }
  }
}

/* ---------- Словарь и «Учить» ---------- */

const POS = { noun: 'сущ.', adjective: 'прил.', verb: 'глагол', numeral: 'числ.', other: '' };
const STATUS = { new: 'Новое', learning: 'Учу', difficult: 'Сложное', mastered: 'Освоено' };
const GEN = { m: 'м.', f: 'ж.', n: 'ср.', 'm/f': 'м./ж.' };

const lists = {
  dict: { action: 'wordsList', box: '#dict-list', more: '#dict-more', count: '#dict-count', offset: 0, busy: false, loaded: false },
  mine: { action: 'myWords', box: '#mine-list', more: '#mine-more', count: '#mine-count', offset: 0, busy: false, loaded: false }
};

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function handleErr(err) {
  if (err.code === 'unauthorized') {
    clearSession(); show('auth'); toast(ERRORS.unauthorized);
  } else {
    toast(ERRORS[err.code] || ERRORS.server_error);
  }
}

function listParams(kind) {
  if (kind !== 'dict') return {};
  return { q: $('#dict-q').value.trim(), gender: $('#dict-gender').value, declension: $('#dict-decl').value, wtype: $('#dict-type').value };
}

function wordCard(w, kind) {
  const c = el('article', 'word');
  const top = el('div', 'word-top');
  top.append(el('h3', 'word-lat', w.latin_word), el('span', 'badge', kind === 'mine' ? (STATUS[w.status] || '') : (POS[w.word_type] || '')));
  c.append(top);
  if (w.dictionary_form && w.dictionary_form !== w.latin_word) c.append(el('p', 'word-form', w.dictionary_form));
  c.append(el('p', 'word-tr', w.russian_translation));
  const meta = [GEN[w.gender], w.declension ? 'скл. ' + w.declension : ''].filter(Boolean).join(' · ');
  if (meta) c.append(el('p', 'muted small', meta));
  const btn = el('button', 'btn-ghost small');
  btn.type = 'button';
  if (kind === 'mine') {
    btn.textContent = 'Убрать';
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        await api('learnRemove', { ids: [w.word_id] });
        c.remove();
        lists.mine.total -= 1;
        $('#mine-count').textContent = 'Слов в списке: ' + lists.mine.total;
        $('#mine-empty').hidden = lists.mine.total > 0;
        lists.dict.loaded = false;
      } catch (err) { btn.disabled = false; handleErr(err); }
    });
  } else {
    const setState = (mine) => { btn.textContent = mine ? '✓ В списке' : '+ Учить'; btn.disabled = mine; };
    setState(w.mine);
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try { await api('learnAdd', { ids: [w.word_id] }); setState(true); }
      catch (err) { btn.disabled = false; handleErr(err); }
    });
  }
  c.append(btn);
  return c;
}

async function loadList(kind, reset) {
  const L = lists[kind];
  if (L.busy) return;
  L.busy = true;
  if (reset) { L.offset = 0; $(L.box).replaceChildren(); }
  $(L.count).textContent = 'Загрузка…';
  try {
    const data = await api(L.action, { ...listParams(kind), offset: L.offset, limit: 30 });
    L.total = data.total;
    data.items.forEach((w, i) => { const c = wordCard(w, kind); c.style.setProperty('--i', Math.min(i, 12)); $(L.box).append(c); });
    L.offset += data.items.length;
    $(L.count).textContent = (kind === 'dict' ? 'Найдено: ' : 'Слов в списке: ') + data.total;
    $(L.more).hidden = L.offset >= data.total;
    if (kind === 'mine') $('#mine-empty').hidden = data.total > 0;
    L.loaded = true;
  } catch (err) {
    $(L.count).textContent = 'Не удалось загрузить список (' + (err.code || 'ошибка') + '). Нажмите на раздел ещё раз.';
    handleErr(err);
  } finally { L.busy = false; }
}

function openDict() { show('dict'); if (!lists.dict.loaded) loadList('dict', true); }
function openMine() { show('mine'); loadList('mine', true); }

document.querySelectorAll('#nav button').forEach((b) => b.addEventListener('click', () => {
  if (b.dataset.go === 'dict') openDict();
  else if (b.dataset.go === 'mine') openMine();
  else renderHome();
}));
$('#btn-home-dict').addEventListener('click', openDict);
$('#btn-home-mine').addEventListener('click', openMine);
$('#dict-more').addEventListener('click', () => loadList('dict', false));
$('#mine-more').addEventListener('click', () => loadList('mine', false));

let searchTimer;
$('#dict-q').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => loadList('dict', true), 350); });
['#dict-gender', '#dict-decl', '#dict-type'].forEach((s) => $(s).addEventListener('change', () => loadList('dict', true)));

$('#dict-add-all').addEventListener('click', async () => {
  if (!confirm('Добавить в ваш список все найденные слова (кроме уже добавленных, не более 500)?')) return;
  const btn = $('#dict-add-all');
  btn.disabled = true;
  try {
    const r = await api('learnAddFiltered', listParams('dict'));
    toast('Добавлено слов: ' + r.added, true);
    loadList('dict', true);
  } catch (err) { handleErr(err); }
  finally { btn.disabled = false; }
});

/* ---------- Тренировка и статистика ---------- */

const norm = (s) => String(s == null ? '' : s).toLowerCase().replace(/ё/g, 'е').normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().replace(/[.!?]+$/, '').trim();
const Q_LABELS = {
  ru2la: 'Напишите по-латыни', la2ru: 'Напишите перевод', gender: 'Определите род',
  ending: 'Окончание родительного падежа (ae, i, is, us, ei)', declension: 'Определите склонение'
};
const ERR_NAMES = { orthography: 'орфография', ending: 'окончания', gender: 'род', declension: 'склонение', translation: 'перевод' };
let T = null;

async function loadStats() {
  try {
    const s = await api('stats');
    state.user.level = s.level; state.user.xp = s.xp;
    $('#home-level').textContent = s.level;
    $('#home-xp').textContent = s.xp;
    $('#home-levelname').textContent = s.levelName;
    $('#home-xptext').textContent = s.next === null ? 'максимальный уровень' : s.xp + ' / ' + s.next + ' XP';
    $('#xp-fill').style.width = (s.next === null ? 100 : Math.round(((s.xp - s.floor) / (s.next - s.floor)) * 100)) + '%';
    const c = s.counts;
    $('#cnt-total').textContent = c.total; $('#cnt-mastered').textContent = c.mastered;
    $('#cnt-difficult').textContent = c.difficult; $('#cnt-due').textContent = c.due;
    const all = s.correct + s.wrong;
    $('#home-acc').textContent = all ? 'Правильных ответов: ' + Math.round((s.correct / all) * 100) + '% (' + s.correct + ' из ' + all + ')' : 'Ответов пока нет';
  } catch (err) { if (err.code === 'unauthorized') handleErr(err); }
}

async function startTrain(mode) {
  toast('Подбираем слова…');
  try {
    const d = await api('trainStart', { mode });
    $('#toast').hidden = true;
    if (!d.questions.length) {
      toast(mode === 'errors' ? 'Слов с ошибками пока нет.' : 'Сейчас нет слов для повторения. Добавьте слова в «Учить» или загляните позже.');
      return;
    }
    T = { queue: d.questions.slice(), answers: [], done: 0, total: d.questions.length, cur: null, choice: '' };
    $('#train-result').hidden = true; $('#train-card').hidden = false;
    show('train'); showQuestion();
  } catch (err) { handleErr(err); }
}

function showQuestion() {
  const q = T.cur = T.queue.shift();
  $('#q-label').textContent = Q_LABELS[q.type];
  $('#q-prompt').textContent = q.prompt;
  const opts = $('#q-options'), input = $('#q-input');
  opts.replaceChildren(); T.choice = ''; input.value = ''; input.hidden = !!q.options;
  if (q.options) {
    q.options.forEach((o) => {
      const b = el('button', 'opt', o.t); b.type = 'button';
      b.addEventListener('click', () => { opts.querySelectorAll('.opt').forEach((x) => x.classList.remove('sel')); b.classList.add('sel'); T.choice = o.v; });
      opts.append(b);
    });
  }
  const card = $('#train-card');
  card.className = 'card q'; void card.offsetWidth;
  $('#q-feedback').hidden = true; $('#q-check').hidden = false;
  $('#train-bar').style.width = Math.round((T.done / T.total) * 100) + '%';
  $('#train-pos').textContent = T.done + ' / ' + T.total;
  if (!q.options) input.focus();
}

$('#q-form').addEventListener('submit', (e) => {
  e.preventDefault();
  if (!T || !T.cur || !$('#q-feedback').hidden) return;
  const q = T.cur, answer = q.options ? T.choice : $('#q-input').value;
  if (!String(answer).trim()) return;
  const ok = q.accept.map(norm).includes(norm(answer));
  T.answers.push({ word_id: q.word_id, type: q.type, answer: String(answer) });
  if (!ok && !q.retry) T.queue.splice(Math.min(3, T.queue.length), 0, { ...q, retry: true });
  else T.done += 1;
  $('#train-card').className = 'card q ' + (ok ? 'ok' : 'bad');
  $('#q-verdict').textContent = ok ? 'Верно!' : 'Неверно. Правильно: ' + q.show;
  $('#q-note').textContent = q.note || '';
  $('#q-check').hidden = true; $('#q-feedback').hidden = false;
  $('#train-bar').style.width = Math.round((T.done / T.total) * 100) + '%';
  $('#train-pos').textContent = T.done + ' / ' + T.total;
  $('#q-next').focus();
});

$('#q-next').addEventListener('click', () => { if (T.queue.length) showQuestion(); else finishTrain(false); });
$('#train-exit').addEventListener('click', () => finishTrain(true));

async function finishTrain(early) {
  const t = T; T = null;
  if (!t || !t.answers.length) return renderHome();
  try {
    const r = await api('trainSubmit', { answers: t.answers });
    if (early) { toast('+' + r.gained + ' XP', true); return renderHome(); }
    showResult(r);
  } catch (err) { handleErr(err); }
}

function showResult(r) {
  const ok = r.results.filter((x) => x.correct).length, bad = r.results.length - ok;
  $('#train-card').hidden = true; $('#train-result').hidden = false;
  $('#res-xp').textContent = '+' + r.gained + ' XP';
  $('#res-stat').textContent = 'Верных ответов: ' + ok + ', ошибок: ' + bad;
  $('#res-level').textContent = r.leveledUp ? 'Новый уровень: ' + r.levelName + ' 🎉' : 'Уровень: ' + r.levelName + ' · ' + r.xp + ' XP';
  const errs = {}; r.results.forEach((x) => { if (!x.correct) errs[x.errorType] = (errs[x.errorType] || 0) + 1; });
  $('#res-errors').textContent = Object.keys(errs).length ? 'Ошибки: ' + Object.keys(errs).map((k) => (ERR_NAMES[k] || k) + ' — ' + errs[k]).join(', ') : '';
  $('#res-hint').hidden = r.gained > 0;
  const card = $('#train-result'); card.classList.remove('view-in'); void card.offsetWidth; card.classList.add('view-in');
}

$('#btn-train').addEventListener('click', () => startTrain('review'));
$('#btn-errors').addEventListener('click', () => startTrain('errors'));
$('#res-again').addEventListener('click', () => startTrain('review'));
$('#res-errors-btn').addEventListener('click', () => startTrain('errors'));
$('#res-home').addEventListener('click', () => renderHome());
$('#mine-train').addEventListener('click', () => startTrain('review'));
$('#mine-clear').addEventListener('click', async () => {
  if (!confirm('Очистить весь ваш список «Учить»? Прогресс по этим словам будет сброшен. Общий словарь не изменится.')) return;
  try {
    const r = await api('learnRemove', { all: true });
    toast('Удалено слов: ' + r.removed, true);
    lists.dict.loaded = false; loadList('mine', true);
  } catch (err) { handleErr(err); }
});

/* ---------- Профиль ---------- */

async function openProfile() {
  const u = state.user;
  show('profile');
  $('#pf-avatar').textContent = (u.username || '?').charAt(0).toUpperCase();
  $('#pf-name').textContent = u.username;
  const d = new Date(u.registration_date);
  $('#pf-since').textContent = isNaN(d) ? '' : 'В приложении с ' + d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
  try {
    const [s, hard] = await Promise.all([api('stats'), api('myWords', { status: 'difficult', limit: 10 })]);
    $('#pf-level').textContent = 'Уровень ' + s.level + ' · ' + s.levelName;
    $('#pf-xp').textContent = s.next === null ? s.xp + ' XP' : s.xp + ' / ' + s.next + ' XP';
    $('#pf-fill').style.width = (s.next === null ? 100 : Math.round(((s.xp - s.floor) / (s.next - s.floor)) * 100)) + '%';
    const c = s.counts, all = s.correct + s.wrong;
    $('#pf-total').textContent = c.total; $('#pf-mastered').textContent = c.mastered;
    $('#pf-difficult').textContent = c.difficult; $('#pf-due').textContent = c.due;
    $('#pf-answers').textContent = all; $('#pf-acc').textContent = all ? Math.round((s.correct / all) * 100) + '%' : '—';

    const chart = $('#pf-chart'); chart.replaceChildren();
    const max = Math.max(1, ...s.daily.map((x) => x.correct + x.wrong));
    s.daily.forEach((x) => {
      const day = el('div', 'day'), bars = el('div', 'bars'), ok = el('div', 'bar ok'), bad = el('div', 'bar bad');
      ok.style.setProperty('--h', Math.round((x.correct / max) * 100));
      bad.style.setProperty('--h', Math.round((x.wrong / max) * 100));
      ok.title = 'Верных: ' + x.correct; bad.title = 'Ошибок: ' + x.wrong;
      bars.append(ok, bad);
      day.append(bars, el('span', 'muted small', x.date.slice(8, 10) + '.' + x.date.slice(5, 7)));
      chart.append(day);
    });

    const eb = $('#pf-errors'); eb.replaceChildren();
    const keys = Object.keys(s.errors).filter((k) => k);
    if (!keys.length) eb.append(el('p', 'muted', 'Ошибок пока нет. Пройдите тренировку, и здесь появится разбор.'));
    const emax = Math.max(1, ...keys.map((k) => s.errors[k]));
    keys.sort((a, b) => s.errors[b] - s.errors[a]).forEach((k) => {
      const row = el('div', 'errrow'), top = el('div', 'errrow-top'), track = el('div', 'errtrack'), fill = el('div', 'errfill');
      top.append(el('span', '', ERR_NAMES[k] || k), el('span', 'muted', String(s.errors[k])));
      fill.style.setProperty('--w', Math.round((s.errors[k] / emax) * 100));
      track.append(fill); row.append(top, track); eb.append(row);
    });

    const hb = $('#pf-hard'); hb.replaceChildren();
    if (!hard.items.length) hb.append(el('p', 'muted', 'Сложных слов пока нет.'));
    hard.items.forEach((w) => {
      const it = el('div', 'hard-item');
      it.append(el('b', '', w.latin_word), el('span', 'muted small', w.russian_translation + ' · ошибок: ' + w.wrong));
      hb.append(it);
    });
  } catch (err) { handleErr(err); }
}

$('#menu-profile').addEventListener('click', () => { toggleMenu(false); openProfile(); });
$('#pf-fix').addEventListener('click', () => startTrain('errors'));

/* ---------- Меню и помощь ---------- */

function toggleMenu(open) {
  const menu = $('#menu'), burger = $('#menu-btn');
  const o = open === undefined ? menu.hidden : open;
  menu.hidden = !o;
  burger.setAttribute('aria-expanded', String(o));
}
function closeHelp() { $('#help').hidden = true; }

$('#menu-btn').addEventListener('click', (e) => { e.stopPropagation(); toggleMenu(); });
document.addEventListener('click', (e) => { if (!$('#menu').hidden && !$('#menu').contains(e.target)) toggleMenu(false); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { toggleMenu(false); closeHelp(); } });
$('#menu-help').addEventListener('click', () => { toggleMenu(false); $('#help').hidden = false; });
$('#help-close').addEventListener('click', closeHelp);
$('#help').addEventListener('click', (e) => { if (e.target.id === 'help') closeHelp(); });

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => { /* PWA необязательна для работы */ });
  });
}

init();
