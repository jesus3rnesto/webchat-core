(() => {
  'use strict';

  const API = {
    create: '/api/session/create',
    join: '/api/session/join',
    status: '/api/session/status',
    send: '/api/messages/send',
    get: '/api/messages/get',
  };

  const POLL_MS = 3000;
  const WARN_BEFORE_EXPIRY_MS = 10 * 60 * 1000; // 10 minutos

  // ---------- identidad local del dispositivo ----------
  // Un UUID aleatorio guardado en este navegador. El servidor nunca guarda este
  // valor en texto plano, solo un hash con un "pepper" del lado del servidor.
  function getDeviceId() {
    let id = localStorage.getItem('deviceId');
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem('deviceId', id);
    }
    return id;
  }
  const deviceId = getDeviceId();

  // ---------- estado de la sesión activa ----------
  const state = {
    code: null,
    role: null,
    lastMessageId: 0,
    pollTimer: null,
    expiresAt: null,
    notifiedExpiry: false,
  };

  // ---------- helpers de DOM ----------
  const $ = (id) => document.getElementById(id);
  const show = (el) => el.classList.remove('modal-overlay--hidden', 'view--hidden', 'chat-banner--hidden');
  const hide = (el) => el.classList.add('modal-overlay--hidden');

  function setError(el, message) {
    if (!message) {
      el.textContent = '';
      el.classList.add('form-error--hidden');
      return;
    }
    el.textContent = message;
    el.classList.remove('form-error--hidden');
  }

  async function api(url, options = {}) {
    const res = await fetch(url, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    });
    let data = {};
    try { data = await res.json(); } catch { /* respuesta sin cuerpo */ }
    if (!res.ok) {
      const err = new Error(data.error || 'Error de red.');
      err.status = res.status;
      throw err;
    }
    return data;
  }

  // ================= MODAL: CREAR =================
  const modalCreate = $('modal-create');
  const createStepForm = $('create-step-form');
  const createStepResult = $('create-step-result');

  $('btn-open-create').addEventListener('click', () => {
    createStepForm.classList.remove('view--hidden');
    createStepResult.classList.add('view--hidden');
    $('create-password').value = '';
    setError($('create-error'), '');
    show(modalCreate);
    $('create-password').focus();
  });
  $('create-cancel').addEventListener('click', () => hide(modalCreate));

  $('create-submit').addEventListener('click', async () => {
    const password = $('create-password').value;
    if (password.length < 6) {
      setError($('create-error'), 'La contraseña debe tener al menos 6 caracteres.');
      return;
    }
    $('create-submit').disabled = true;
    try {
      const data = await api(API.create, {
        method: 'POST',
        body: JSON.stringify({ deviceId, password }),
      });
      $('result-code').textContent = data.code;
      $('result-password').textContent = password;
      createStepForm.classList.add('view--hidden');
      createStepResult.classList.remove('view--hidden');
      createStepResult.dataset.code = data.code;
      createStepResult.dataset.password = password;
    } catch (err) {
      setError($('create-error'), err.message);
    } finally {
      $('create-submit').disabled = false;
    }
  });

  $('create-enter').addEventListener('click', () => {
    const code = createStepResult.dataset.code;
    hide(modalCreate);
    enterChat(code, 'creator');
  });

  // ================= MODAL: UNIRSE =================
  const modalJoin = $('modal-join');

  $('btn-open-join').addEventListener('click', () => {
    $('join-code').value = '';
    $('join-password').value = '';
    setError($('join-error'), '');
    show(modalJoin);
    $('join-code').focus();
  });
  $('join-cancel').addEventListener('click', () => hide(modalJoin));

  $('join-submit').addEventListener('click', async () => {
    const code = $('join-code').value.trim().toUpperCase();
    const password = $('join-password').value;
    if (!code || !password) {
      setError($('join-error'), 'Completá el código y la contraseña.');
      return;
    }
    $('join-submit').disabled = true;
    try {
      const data = await api(API.join, {
        method: 'POST',
        body: JSON.stringify({ deviceId, code, password }),
      });
      hide(modalJoin);
      enterChat(code, data.role);
    } catch (err) {
      setError($('join-error'), err.message);
    } finally {
      $('join-submit').disabled = false;
    }
  });

  // ================= CHAT =================
  const viewLanding = $('view-landing');
  const viewChat = $('view-chat');
  const chatLog = $('chat-log');
  const chatBanner = $('chat-banner');

  function formatRemaining(ms) {
    if (ms <= 0) return 'expirada';
    const totalMin = Math.floor(ms / 60000);
    const days = Math.floor(totalMin / 1440);
    const hours = Math.floor((totalMin % 1440) / 60);
    const mins = totalMin % 60;
    if (days > 0) return `${days}d ${hours}h restantes`;
    if (hours > 0) return `${hours}h ${mins}m restantes`;
    return `${mins}m restantes`;
  }

  function updateExpiryPill() {
    if (!state.expiresAt) return;
    const remaining = new Date(state.expiresAt).getTime() - Date.now();
    const pill = $('chat-expiry');
    pill.textContent = formatRemaining(remaining);
    pill.classList.toggle('pill--warn', remaining > 0 && remaining <= WARN_BEFORE_EXPIRY_MS);

    if (remaining > 0 && remaining <= WARN_BEFORE_EXPIRY_MS && !state.notifiedExpiry) {
      state.notifiedExpiry = true;
      notifyExpirySoon(remaining);
    }
  }

  function notifyExpirySoon(remaining) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    try {
      new Notification('La sesión está por expirar', {
        body: `Quedan ${formatRemaining(remaining)}. Guardá lo que necesites de esta conversación.`,
      });
    } catch { /* algunos navegadores en segundo plano pueden fallar silenciosamente */ }
  }

  function requestNotificationPermission() {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }
  }

  function renderMessage(msg) {
    const own = msg.sender === state.role;
    const row = document.createElement('div');
    row.className = `msg ${own ? 'msg--own' : 'msg--other'}`;

    const meta = document.createElement('div');
    meta.className = 'msg__meta';
    const time = new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    meta.textContent = `${own ? 'vos' : 'la otra persona'} · ${time}`;
    row.appendChild(meta);

    if (msg.msg_type === 'gif') {
      const img = document.createElement('img');
      img.src = msg.content;
      img.alt = 'GIF enviado en el chat';
      img.loading = 'lazy';
      img.referrerPolicy = 'no-referrer';
      img.className = 'msg__gif';
      row.appendChild(img);
    } else {
      const text = document.createElement('div');
      text.className = 'msg__text';
      text.textContent = msg.content; // textContent evita cualquier inyección de HTML
      row.appendChild(text);
    }

    chatLog.appendChild(row);
  }

  function clearChatLog() {
    chatLog.innerHTML = '';
  }

  function setBanner(message) {
    if (!message) {
      chatBanner.textContent = '';
      chatBanner.classList.add('chat-banner--hidden');
      return;
    }
    chatBanner.textContent = message;
    chatBanner.classList.remove('chat-banner--hidden');
  }

  function stopPolling() {
    if (state.pollTimer) {
      clearInterval(state.pollTimer);
      state.pollTimer = null;
    }
  }

  function lockInput(locked) {
    $('chat-input').disabled = locked;
    $('btn-gif').disabled = locked;
    document.querySelector('#chat-form button[type="submit"]').disabled = locked;
  }

  async function poll() {
    try {
      const url = `${API.get}?code=${encodeURIComponent(state.code)}&deviceId=${encodeURIComponent(deviceId)}&after=${state.lastMessageId}`;
      const data = await api(url);

      for (const msg of data.messages) {
        renderMessage(msg);
        state.lastMessageId = msg.id;
      }
      if (data.messages.length > 0) {
        chatLog.scrollTop = chatLog.scrollHeight;
      }

      state.expiresAt = data.expiresAt;
      updateExpiryPill();

      if (data.status === 'expired') {
        setBanner('Esta sesión expiró. Ya no se pueden enviar ni recibir mensajes.');
        lockInput(true);
        stopPolling();
      } else if (state.role === 'creator' && !data.otherPresent) {
        setBanner('Esperando a que la otra persona ingrese el código y la contraseña…');
      } else {
        setBanner(null);
      }
    } catch (err) {
      if (err.status === 403 || err.status === 404) {
        setBanner('Perdiste el acceso a esta sesión.');
        lockInput(true);
        stopPolling();
      }
      // otros errores (red intermitente) se ignoran y se reintenta en el siguiente ciclo
    }
  }

  function enterChat(code, role) {
    state.code = code;
    state.role = role;
    state.lastMessageId = 0;
    state.notifiedExpiry = false;
    clearChatLog();
    lockInput(false);
    setBanner(null);

    $('chat-code').textContent = code;
    $('chat-role').textContent = role === 'creator' ? 'sos la persona 1' : 'sos la persona 2';

    viewLanding.classList.add('view--hidden');
    viewChat.classList.remove('view--hidden');

    requestNotificationPermission();

    poll();
    stopPolling();
    state.pollTimer = setInterval(poll, POLL_MS);
    setInterval(updateExpiryPill, 15000);
  }

  function leaveChat() {
    stopPolling();
    state.code = null;
    state.role = null;
    viewChat.classList.add('view--hidden');
    viewLanding.classList.remove('view--hidden');
  }

  $('btn-leave').addEventListener('click', leaveChat);

  // ---------- enviar texto ----------
  $('chat-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = $('chat-input');
    const text = input.value.trim();
    if (!text) return;
    input.disabled = true;
    try {
      await api(API.send, {
        method: 'POST',
        body: JSON.stringify({ code: state.code, deviceId, type: 'text', content: text }),
      });
      input.value = '';
      await poll();
    } catch (err) {
      setBanner(err.message);
    } finally {
      input.disabled = false;
      input.focus();
    }
  });

  // ---------- enviar GIF ----------
  const modalGif = $('modal-gif');
  $('btn-gif').addEventListener('click', () => {
    $('gif-url').value = '';
    setError($('gif-error'), '');
    show(modalGif);
    $('gif-url').focus();
  });
  $('gif-cancel').addEventListener('click', () => hide(modalGif));

  $('gif-submit').addEventListener('click', async () => {
    const url = $('gif-url').value.trim();
    if (!/^https:\/\/.+\.gif(\?.*)?$/i.test(url)) {
      setError($('gif-error'), 'Tiene que ser un enlace https que termine en .gif');
      return;
    }
    $('gif-submit').disabled = true;
    try {
      await api(API.send, {
        method: 'POST',
        body: JSON.stringify({ code: state.code, deviceId, type: 'gif', content: url }),
      });
      hide(modalGif);
      await poll();
    } catch (err) {
      setError($('gif-error'), err.message);
    } finally {
      $('gif-submit').disabled = false;
    }
  });

  // cerrar modales al hacer click fuera del cuadro
  document.querySelectorAll('.modal-overlay').forEach((overlay) => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) hide(overlay);
    });
  });
})();
