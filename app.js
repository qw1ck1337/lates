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

const views = ['auth', 'home', 'change'];

function show(name) {
  $('#boot').hidden = true;
  views.forEach((v) => { $('#view-' + v).hidden = v !== name; });
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

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => { /* PWA необязательна для работы */ });
  });
}

init();
