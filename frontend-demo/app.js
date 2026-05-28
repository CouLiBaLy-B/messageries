// Démo simple — pas de framework, juste fetch + Socket.IO
const $ = (sel) => document.querySelector(sel);

const state = {
  apiUrl: 'http://localhost:3000/api/v1',
  accessToken: null,
  user: null,
  socket: null,
  currentConversation: null,
  typingTimeout: null,
};

// -------- helpers --------
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}
function setStatus(ok, text) {
  const el = $('#connStatus');
  el.className = 'status' + (ok ? ' ok' : '');
  el.textContent = text;
}
async function api(path, opts = {}) {
  const res = await fetch(state.apiUrl + path, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(state.accessToken ? { Authorization: 'Bearer ' + state.accessToken } : {}),
      ...(opts.headers || {}),
    },
    credentials: 'include',
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || `HTTP ${res.status}`);
  }
  return res.status === 204 ? null : res.json();
}

// -------- auth --------
$('#loginBtn').addEventListener('click', async () => {
  $('#loginErr').style.display = 'none';
  state.apiUrl = $('#apiUrl').value.trim();
  try {
    const r = await api('/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        email: $('#loginEmail').value,
        password: $('#loginPwd').value,
      }),
    });
    state.accessToken = r.accessToken;
    state.user = r.user;
    afterLogin();
  } catch (e) {
    $('#loginErr').textContent = e.message;
    $('#loginErr').style.display = 'block';
  }
});

$('#registerBtn').addEventListener('click', async () => {
  state.apiUrl = $('#apiUrl').value.trim();
  try {
    await api('/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        email: $('#loginEmail').value,
        password: $('#loginPwd').value,
        role: 'customer',
      }),
    });
    $('#loginErr').style.background = 'var(--ok)';
    $('#loginErr').textContent = 'Compte créé, vous pouvez vous connecter.';
    $('#loginErr').style.display = 'block';
  } catch (e) {
    $('#loginErr').style.background = 'var(--err)';
    $('#loginErr').textContent = e.message;
    $('#loginErr').style.display = 'block';
  }
});

$('#logoutBtn').addEventListener('click', async () => {
  try { await api('/auth/logout', { method: 'POST' }); } catch {}
  location.reload();
});

// Phase 2 : Export RGPD
$('#exportBtn').addEventListener('click', async () => {
  try {
    const data = await api('/me/data/export');
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `export-${state.user.email}-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) { alert(e.message); }
});

// Phase 2 : Signaler un message
async function reportMessage(messageId) {
  const reason = prompt('Raison du signalement (spam, abuse, sensitive_data, ...) :', 'spam');
  if (!reason) return;
  try {
    await api(`/messages/${messageId}/report`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
    alert('Signalement envoyé. Merci.');
  } catch (e) { alert(e.message); }
}

function afterLogin() {
  $('#loginModal').style.display = 'none';
  $('#who').textContent = `${state.user.email} (${state.user.role})`;
  $('#logoutBtn').style.display = '';
  $('#exportBtn').style.display = '';
  loadConversations();
  connectSocket();
}

// -------- conversations --------
async function loadConversations() {
  const list = await api('/conversations');
  const el = $('#convList');
  el.innerHTML = '';
  list.forEach((c) => {
    const div = document.createElement('div');
    div.className = 'conv-item';
    div.innerHTML = `
      <div class="subject">${escapeHtml(c.subject || 'Conversation')}</div>
      <div class="last">${c.lastMessageAt ? new Date(c.lastMessageAt).toLocaleString() : '—'}</div>
    `;
    div.onclick = () => openConversation(c.id);
    el.appendChild(div);
  });
}

$('#openOrderBtn').addEventListener('click', async () => {
  const orderId = $('#orderIdInput').value.trim();
  if (!orderId) return;
  try {
    const conv = await api(`/conversations/by-order/${orderId}`, { method: 'POST' });
    await loadConversations();
    openConversation(conv.id);
  } catch (e) { alert(e.message); }
});

async function openConversation(id) {
  state.currentConversation = id;
  document.querySelectorAll('.conv-item').forEach(e => e.classList.remove('active'));
  state.socket?.emit('conversation.join', { conversationId: id }, (ack) => {
    if (!ack?.ok) alert('Accès refusé à la conversation');
  });
  const conv = await api(`/conversations/${id}`);
  $('#chatHeader').innerHTML = `
    <strong>${escapeHtml(conv.subject || 'Conversation')}</strong>
    <small style="color:var(--muted)">— participants: ${conv.participants.length}</small>
  `;
  const msgs = await api(`/conversations/${id}/messages?limit=50`);
  $('#messages').innerHTML = '';
  msgs.reverse().forEach(renderMessage);
  scrollToBottom();
  $('#msgInput').disabled = false;
  $('#sendBtn').disabled = false;

  if (msgs.length) {
    const last = msgs[msgs.length - 1].sequence;
    api(`/conversations/${id}/messages/read`, {
      method: 'POST',
      body: JSON.stringify({ uptoSequence: String(last) }),
    }).catch(() => {});
  }
}

function renderMessage(m) {
  if (state.currentConversation !== m.conversationId) return;
  const div = document.createElement('div');
  const isMe = m.senderId === state.user.id;
  div.className = 'msg ' + (isMe ? 'me' : 'other');
  const flags = (m.moderationFlags && m.moderationFlags.length)
    ? `<span style="background:#f59e0b;color:#000;padding:1px 6px;border-radius:8px;font-size:9px;margin-left:6px">⚠ ${m.moderationFlags.join(', ')}</span>` : '';
  div.innerHTML = `
    ${escapeHtml(m.body)}${flags}
    <div class="meta">
      #${m.sequence} • ${new Date(m.createdAt).toLocaleTimeString()}
      ${!isMe ? `<a href="#" data-id="${m.id}" class="report" style="margin-left:6px;color:#fca5a5">signaler</a>` : ''}
    </div>
  `;
  const report = div.querySelector('.report');
  if (report) report.addEventListener('click', (e) => {
    e.preventDefault();
    reportMessage(report.dataset.id);
  });
  $('#messages').appendChild(div);
}
function scrollToBottom() {
  const m = $('#messages');
  m.scrollTop = m.scrollHeight;
}

// -------- send --------
$('#composer').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = $('#msgInput').value.trim();
  if (!body || !state.currentConversation) return;
  $('#msgInput').value = '';
  const idempotencyKey = crypto.randomUUID();
  try {
    await api(`/conversations/${state.currentConversation}/messages`, {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify({ body }),
    });
  } catch (e) { alert(e.message); }
});

$('#msgInput').addEventListener('input', () => {
  if (!state.socket || !state.currentConversation) return;
  state.socket.emit('typing', {
    conversationId: state.currentConversation,
    isTyping: true,
  });
  clearTimeout(state.typingTimeout);
  state.typingTimeout = setTimeout(() => {
    state.socket.emit('typing', {
      conversationId: state.currentConversation,
      isTyping: false,
    });
  }, 1500);
});

// -------- WebSocket --------
function connectSocket() {
  const wsBase = state.apiUrl.replace(/\/api\/v1$/, '');
  state.socket = io(wsBase + '/ws', {
    transports: ['websocket'],
    auth: { token: state.accessToken },
    withCredentials: true,
  });
  state.socket.on('connect', () => setStatus(true, 'online'));
  state.socket.on('disconnect', () => setStatus(false, 'offline'));
  state.socket.on('connect_error', (e) => {
    setStatus(false, 'erreur');
    console.error('WS error', e);
  });

  state.socket.on('message.created', (m) => {
    renderMessage(m);
    scrollToBottom();
  });
  state.socket.on('message.deleted', (m) => {
    console.log('deleted', m);
  });
  state.socket.on('message.read', (r) => {
    console.log('read receipt', r);
  });
  state.socket.on('typing', (t) => {
    if (t.conversationId !== state.currentConversation) return;
    if (t.userId === state.user.id) return;
    $('#typing').textContent = t.isTyping ? '✏️ en train d\'écrire...' : '';
  });

  // Heartbeat presence toutes les 25s
  setInterval(() => state.socket?.emit('presence.ping'), 25_000);
}
