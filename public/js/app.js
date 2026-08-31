'use strict';

const App = {
  me: null,
  token: null,
  conversations: [],
  convMeta: {}, // convId -> summary with members
  messages: {}, // convId -> array
  hasMore: {},
  loadingOlder: {},
  activeConvId: null,
  typing: {}, // convId -> Map(userId -> timer)
  searchQuery: '',
  userResults: [],
  notifications: [],
  lastMsgDay: null,
  isRecording: false,
  record: { mediaRecorder: null, chunks: [], stream: null, seconds: 0, timer: null },
  emojiOpen: false,
};

// ---------- boot ----------
async function init() {
  wirePushService();
  const token = Storage.getToken();
  if (token) {
    try {
      const { user } = await API.me();
      App.token = token;
      App.me = user;
      showApp();
      return;
    } catch (_e) {
      Storage.setToken(null);
    }
  }
  showAuth('login');
}

// ---------- auth screens ----------
function showAuth(view = 'login') {
  App.view = 'auth';
  const root = document.getElementById('app');
  root.innerHTML = '';

  const card = el('div', { class: 'auth-card' });
  const brand = el(
    'div',
    { class: 'auth-brand' },
    el('span', { class: 'auth-logo', html: ICONS.logo }),
    el('h1', { class: 'auth-title', text: 'Pulse' }),
    el('p', { class: 'auth-tagline', text: 'Mensagens em tempo real, conectadas.' })
  );

  const form = el('form', { class: 'auth-form' });
  const msg = el('div', { class: 'form-error', hidden: true });

  if (view === 'login') {
    form.append(
      el('h2', { class: 'auth-h2', text: 'Entrar' }),
      field('username', 'Nome de usuário', 'Seu nome de usuário'),
      field('password', 'Senha', 'Sua senha', 'password'),
      msg,
      el('button', { class: 'btn btn-primary btn-block', type: 'submit', text: 'Entrar' })
    );
  } else {
    form.append(
      el('h2', { class: 'auth-h2', text: 'Criar conta' }),
      field('username', 'Nome de usuário', '3 a 20 caracteres (letras, números ou _)'),
      field('password', 'Senha', 'Mínimo de 6 caracteres', 'password'),
      field('password2', 'Confirmar senha', 'Repita a senha', 'password'),
      msg,
      el('button', { class: 'btn btn-primary btn-block', type: 'submit', text: 'Criar conta' })
    );
  }

  const switchLink = el('p', { class: 'auth-switch' });
  if (view === 'login') {
    switchLink.append('Não tem conta? ', el('a', { href: '#', text: 'Cadastre-se' }));
  } else {
    switchLink.append('Já tem conta? ', el('a', { href: '#', text: 'Entrar' }));
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (view === 'login') doLogin(form, msg);
    else doSignup(form, msg);
  });
  switchLink.querySelector('a').addEventListener('click', (e) => {
    e.preventDefault();
    showAuth(view === 'login' ? 'signup' : 'login');
  });

  card.append(brand, form, switchLink);
  root.append(card);
  form.querySelector('#field-username').focus();
}

function field(name, label, placeholder, type = 'text') {
  const wrap = el('div', { class: 'field' });
  wrap.append(
    el('label', { class: 'field-label', text: label, htmlFor: `field-${name}` }),
    el('input', { class: 'input', id: `field-${name}`, name, type, placeholder, autocomplete: type === 'password' ? 'current-password' : 'username' })
  );
  return wrap;
}

function setError(msg, errEl, text) {
  errEl.textContent = text;
  errEl.hidden = false;
  msg.querySelectorAll('input').forEach((i) => i.classList.add('input-error'));
  setTimeout(() => msg.querySelectorAll('input').forEach((i) => i.classList.remove('input-error')), 1500);
}

async function doLogin(form, msg) {
  const username = form.username.value.trim();
  const password = form.password.value;
  if (!username || !password) return setError(msg, msg, 'Preencha nome de usuário e senha.');
  const btn = form.querySelector('button[type=submit]');
  btn.disabled = true;
  btn.textContent = 'Entrando...';
  try {
    const { token, user } = await API.login(username, password);
    Storage.setToken(token);
    App.token = token;
    App.me = user;
    showApp();
  } catch (err) {
    setError(msg, msg, err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Entrar';
  }
}

async function doSignup(form, msg) {
  const username = form.username.value.trim();
  const password = form.password.value;
  const password2 = form.password2.value;
  if (!username || !password) return setError(msg, msg, 'Preencha nome de usuário e senha.');
  if (password.length < 6) return setError(msg, msg, 'A senha deve ter pelo menos 6 caracteres.');
  if (password !== password2) return setError(msg, msg, 'As senhas não coincidem.');
  const btn = form.querySelector('button[type=submit]');
  btn.disabled = true;
  btn.textContent = 'Criando...';
  try {
    const { token, user } = await API.signup(username, password);
    Storage.setToken(token);
    App.token = token;
    App.me = user;
    showProfileSetup();
  } catch (err) {
    setError(msg, msg, err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Criar conta';
  }
}

// ---------- profile setup after signup ----------
function showProfileSetup() {
  App.view = 'setup';
  const root = document.getElementById('app');
  root.innerHTML = '';

  const card = el('div', { class: 'auth-card setup-card' });
  const avatar = avatarEl(App.me, 88, { showOnline: false });
  avatar.classList.add('setup-avatar');

  const hiddenFile = el('input', { type: 'file', accept: 'image/*', hidden: true });
  const avatarBtn = el(
    'button',
    { class: 'avatar-edit', type: 'button', title: 'Adicionar foto' },
    el('span', { class: 'avatar-edit-ico', html: ICONS.camera })
  );
  avatarBtn.addEventListener('click', () => hiddenFile.click());
  hiddenFile.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file || !file.type.startsWith('image/')) return;
    try {
      const { url } = await API.upload(file);
      const { user } = await API.updateMe({ avatar: url });
      App.me = user;
      avatar.innerHTML = '';
      avatar.append(avatarImg(App.me, 88));
      toast('Foto atualizada');
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  const form = el('form', { class: 'auth-form' });
  form.append(
    el('h2', { class: 'auth-h2', text: 'Complete seu perfil' }),
    el('p', { class: 'auth-sub', text: 'Personalize como você aparece no Pulse. Opcional.' }),
    el('div', { class: 'field' },
      el('label', { class: 'field-label', text: 'Nome de exibição' }),
      el('input', { class: 'input', id: 'setup-name', value: App.me.username, maxlength: 40 })
    ),
    el('div', { class: 'field' },
      el('label', { class: 'field-label', text: 'Bio / status' }),
      el('textarea', { class: 'input textarea', id: 'setup-bio', rows: 3, maxlength: 120, placeholder: 'Ex: Disponível para conversar' })
    ),
    el('button', { class: 'btn btn-primary btn-block', type: 'submit', text: 'Começar' })
  );

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const displayName = form.querySelector('#setup-name').value.trim() || App.me.username;
    const bio = form.querySelector('#setup-bio').value.trim();
    try {
      const { user } = await API.updateMe({ displayName, bio });
      App.me = user;
      showApp();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  const wrapAvatar = el('div', { class: 'setup-avatar-wrap' }, avatar, avatarBtn, hiddenFile);
  card.append(wrapAvatar, form);
  root.append(card);
}

function avatarImg(user, size) {
  if (user.avatar) return el('img', { class: 'avatar', src: user.avatar, style: `width:${size}px;height:${size}px;` });
  return el('span', {
    class: 'avatar avatar-initials',
    style: `width:${size}px;height:${size}px;font-size:${Math.round(size * 0.38)}px;background:linear-gradient(135deg, ${avatarGradient(user.username || '?').join(', ')})`,
    text: initialsOf(user.displayName || user.username),
  });
}

// ---------- main app shell ----------
function showApp() {
  App.view = 'app';
  App.conversations = [];
  App.convMeta = {};
  App.messages = {};
  App.activeConvId = null;
  App.typing = {};
  App.notifications = [];

  const root = document.getElementById('app');
  root.innerHTML = '';

  const sidebar = el('aside', { class: 'sidebar' },
    el('header', { class: 'sidebar-header' },
      el('div', { class: 'brand' }, el('span', { class: 'brand-logo', html: ICONS.logo }), el('span', { class: 'brand-name', text: 'Pulse' })),
      el('div', { class: 'header-actions' },
        el('button', { class: 'icon-btn notif-btn', id: 'btnNotif', title: 'Notificações' },
          el('span', { class: 'svg-ico', html: ICONS.bell }),
          el('span', { class: 'notif-badge', hidden: true, text: '0' })
        ),
        el('div', { class: 'menu-wrap' },
          el('button', { class: 'icon-btn avatar-menu-btn', id: 'btnMe', title: 'Meu perfil' }),
          el('div', { class: 'menu', id: 'meMenu', hidden: true })
        )
      )
    ),
    el('div', { class: 'search-wrap' },
      el('span', { class: 'search-ico', html: ICONS.search }),
      el('input', { class: 'input search-input', id: 'searchInput', placeholder: 'Buscar conversas ou pessoas' })
    ),
    el('div', { class: 'conv-list-wrap' },
      el('button', { class: 'newchat-btn', id: 'btnNewChat' },
        el('span', { class: 'newchat-ico', html: ICONS.plus }),
        el('span', { class: 'newchat-txt', text: 'Nova conversa ou grupo' })
      ),
      el('nav', { class: 'conv-list', id: 'convList' })
    ),
    el('div', { class: 'sidebar-footer' },
      el('span', { class: 'footer-me', id: 'footerMe' }),
      el('span', { class: 'footer-meta', text: 'conectado em tempo real' })
    )
  );

  const main = el('main', { class: 'main' },
    el('div', { class: 'empty-state', id: 'emptyState' },
      el('span', { class: 'empty-logo', html: ICONS.logo }),
      el('h2', { class: 'empty-title', text: 'Bem-vindo ao Pulse' }),
      el('p', { class: 'empty-text', text: 'Selecione uma conversa ou inicie uma nova para começar a conversar em tempo real.' })
    ),
    el('section', { class: 'chat', id: 'chatView', hidden: true },
      el('header', { class: 'chat-header' },
        el('button', { class: 'icon-btn back-btn', id: 'btnBack', title: 'Voltar', html: ICONS.back }),
        el('button', { class: 'chat-peer', id: 'chatPeerBtn' },
          el('span', { class: 'chat-peer-avatar', id: 'chatPeerAvatar' }),
          el('span', { class: 'chat-peer-info' },
            el('span', { class: 'chat-peer-name', id: 'chatPeerName' }),
            el('span', { class: 'chat-peer-status', id: 'chatPeerStatus' })
          )
        ),
        el('button', { class: 'icon-btn', id: 'btnChatInfo', title: 'Detalhes', html: ICONS.info })
      ),
      el('div', { class: 'messages', id: 'messages' }),
      el('div', { class: 'composer' },
        el('div', { class: 'typing-banner', id: 'typingBanner', hidden: true }),
        el('div', { class: 'composer-row' },
          el('div', { class: 'emoji-wrap' },
            el('button', { class: 'icon-btn', id: 'btnEmoji', title: 'Emojis', html: ICONS.emoji }),
            el('div', { class: 'emoji-picker', id: 'emojiPicker', hidden: true })
          ),
          el('label', { class: 'icon-btn attach-btn', id: 'btnAttach', title: 'Enviar imagem', html: ICONS.attach },
            el('input', { type: 'file', accept: 'image/*', id: 'fileInput', hidden: true })
          ),
          el('div', { class: 'composer-input-wrap' },
            el('div', { class: 'rec-wrap', id: 'recWrap', hidden: true },
              el('span', { class: 'rec-dot' }),
              el('span', { class: 'rec-timer', id: 'recTimer', text: '0:00' }),
              el('button', { class: 'icon-btn rec-cancel', id: 'btnCancelRec', title: 'Cancelar', html: ICONS.trash }),
              el('button', { class: 'btn btn-primary btn-send-rec', id: 'btnSendRec', text: 'Enviar' })
            ),
            el('textarea', { class: 'input msg-input', id: 'msgInput', rows: 1, placeholder: 'Mensagem' })
          ),
          el('button', { class: 'icon-btn send-btn', id: 'btnSend', title: 'Enviar', hidden: true, html: ICONS.send }),
          el('button', { class: 'icon-btn mic-btn', id: 'btnMic', title: 'Gravar áudio', html: ICONS.mic })
        )
      )
    )
  );

  root.append(sidebar, main);

  wireShellEvents();
  refreshMeUI();
  connectSocket();
  loadConversations();
  updateTitle();
  setupBrowserNotifications();
  if (typeof Notification !== 'undefined' && Notification.permission === 'granted') setupPush();
  openPendingConversation();
}

function setupBrowserNotifications() {
  if (!('Notification' in window) || Notification.permission !== 'default') return;
  const request = () => {
    Notification.requestPermission().then((perm) => {
      if (perm === 'granted') setupPush();
    }).catch(() => {});
  };
  window.addEventListener('click', request, { once: true });
}

async function setupPush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !App.token) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    if (!reg.pushManager) return;
    const { publicKey } = await API.getVapidPublicKey();
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
    }
    await API.pushSubscribe(sub);
    App.pushSub = sub;
  } catch (_err) {
    // Push não disponível (ex.: permissão negada ou navegador sem suporte). O app continua funcionando normalmente.
  }
}

async function teardownPush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      API.pushUnsubscribe(sub.endpoint).catch(() => {});
      sub.unsubscribe().catch(() => {});
    }
  } catch (_err) {}
}

function wirePushService() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.addEventListener('message', (event) => {
    const data = event.data || {};
    if (data.type === 'open-conversation' && data.conversationId) {
      if (App.me) {
        openConversation(data.conversationId);
      } else {
        Storage.setPendingConv(data.conversationId);
      }
    }
  });
}

function openPendingConversation() {
  const convId = Storage.consumePendingConv() || null;
  const params = new URLSearchParams(window.location.search);
  const paramId = params.get('conv');
  if (convId) {
    openConversation(convId);
  } else if (paramId) {
    params.delete('conv');
    const next = window.location.pathname + (params.toString() ? '?' + params.toString() : '');
    history.replaceState(null, '', next);
    openConversation(paramId);
  }
}

function notifyBrowser(notif) {
  if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && document.hidden) {
    try {
      const n = new Notification(notif.title || 'Pulse', {
        body: notif.body || '',
        icon: '/icons/icon-192.png',
        tag: 'pulse-msg',
        badge: '/icons/icon-192.png',
      });
      n.onclick = () => {
        window.focus();
        n.close();
        openConversation(notif.conversationId);
      };
    } catch (err) {}
  }
}

function refreshMeUI() {
  const btnMe = document.getElementById('btnMe');
  if (btnMe) {
    btnMe.innerHTML = '';
    btnMe.append(avatarImg(App.me, 34));
  }
  const footerMe = document.getElementById('footerMe');
  if (footerMe) footerMe.textContent = App.me.displayName;
}

// ---------- socket ----------
function connectSocket() {
  if (Socket.socket) Socket.disconnect();
  const socket = Socket.connect(App.token);

  socket.on('connect_error', () => {
    toast('Conexão em tempo real indisponível. Reconectando...', 'error');
  });

  socket.on('message:new', handleMessageNew);
  socket.on('message:deleted', handleMessageDeleted);
  socket.on('read', handleRead);
  socket.on('typing', handleTyping);
  socket.on('presence', handlePresence);
  socket.on('conversation:update', handleConversationUpdate);
  socket.on('conversation:new', handleConversationNew);
  socket.on('conversation:deleted', ({ conversationId }) => {
    removeConversationFromView(conversationId);
    toast('Uma conversa foi apagada', 'info');
  });
}

// ---------- conversations list ----------
function sortConversations(list) {
  list.sort((a, b) => {
    const aPinned = a.peer && a.peer.isBot ? 1 : 0;
    const bPinned = b.peer && b.peer.isBot ? 1 : 0;
    if (aPinned !== bPinned) return bPinned - aPinned;
    return b.lastActivity - a.lastActivity;
  });
  return list;
}

async function loadConversations() {
  try {
    const { conversations } = await API.conversations();
    App.conversations = sortConversations(conversations);
    for (const c of conversations) App.convMeta[c.id] = c;
    renderConversations();
    updateTitle();
    refreshNotifBadge();
  } catch (err) {
    if (err.status === 401) {
      logout();
    } else {
      toast(err.message, 'error');
    }
  }
}

function isTypingIn(convId) {
  return !!(App.typing[convId] && App.typing[convId].size);
}

function renderConversations() {
  const list = document.getElementById('convList');
  if (!list) return;
  const q = App.searchQuery.trim().toLowerCase();
  list.innerHTML = '';

  const results = el('div', { class: 'search-results', id: 'searchResults' });

  if (q) {
    const convMatches = App.conversations.filter((c) => (c.name || '').toLowerCase().includes(q));
    const userMatches = App.userResults;
    if (convMatches.length) {
      results.append(el('div', { class: 'search-section' }, el('h4', { class: 'search-head', text: 'Conversas' })));
      for (const c of convMatches) results.append(convItem(c, true));
    }
    if (userMatches.length) {
      results.append(el('div', { class: 'search-section' }, el('h4', { class: 'search-head', text: 'Pessoas' })));
      for (const u of userMatches) results.append(userItem(u));
    }
    if (!convMatches.length && !userMatches.length) {
      results.append(el('div', { class: 'search-empty', text: 'Nenhum resultado para "' + q + '"' }));
    }
    list.append(results);
    return;
  }

  if (!App.conversations.length) {
    list.append(el('div', { class: 'list-empty', text: 'Nenhuma conversa ainda. Toque em "Nova conversa" para começar.' }));
    return;
  }

  for (const c of App.conversations) list.append(convItem(c, false));
}

function convItem(c, inSearch) {
  const typing = isTypingIn(c.id);
  const lastMsg = c.lastMessage;
  const isBotConv = !!(c.peer && c.peer.isBot);
  const item = el('div', { class: 'conv-item' + (App.activeConvId === c.id ? ' active' : '') + (isBotConv ? ' pinned' : ''), 'data-id': c.id });

  const peerForDot = c.type === 'private' && c.peer ? c.peer : null;
  item.append(
    avatarEl(
      { avatar: c.avatar, displayName: c.name, username: (c.peer && c.peer.username) || '' },
      46,
      { showOnline: c.type === 'private' && !isBotConv, online: peerForDot ? peerForDot.online : false }
    ),
    el('div', { class: 'conv-mid' },
      el('div', { class: 'conv-name' },
        el('span', { class: 'conv-name-text', text: c.name }),
        isBotConv ? el('span', { class: 'conv-bot-badge', text: 'IA' }) : null
      ),
      el('div', { class: 'conv-last' + (c.unread ? ' unread' : '') + (typing ? ' typing' : ''),
        text: typing ? 'digitando...' : messagePreviewText(lastMsg, App.me.id) })
    ),
    el('div', { class: 'conv-right' },
      el('div', { class: 'conv-time', text: c.lastMessage ? formatConvTime(c.lastMessage.createdAt) : '' }),
      c.unread ? el('span', { class: 'conv-badge', text: c.unread > 99 ? '99+' : c.unread }) : null
    )
  );

  item.addEventListener('click', () => {
    openConversation(c.id);
  });
  return item;
}

function userItem(u) {
  const item = el('div', { class: 'conv-item' });
  item.append(
    avatarEl(u, 46, { showOnline: true, online: u.online }),
    el('div', { class: 'conv-mid' },
      el('div', { class: 'conv-name', text: u.displayName }),
      el('div', { class: 'conv-last', text: '@' + u.username + ' — ' + (u.bio || 'sem bio') })
    ),
    el('div', { class: 'conv-right' }, el('button', { class: 'btn btn-primary btn-sm', text: 'Conversar' }))
  );
  item.addEventListener('click', async () => {
    try {
      const { conversation } = await API.createPrivate(u.id);
      App.searchQuery = '';
      document.getElementById('searchInput').value = '';
      upsertConversation(conversation);
      openConversation(conversation.id);
    } catch (err) {
      toast(err.message, 'error');
    }
  });
  return item;
}

function upsertConversation(conv) {
  const summary = convSummaryFrom(conv);
  const idx = App.conversations.findIndex((c) => c.id === conv.id);
  if (idx >= 0) App.conversations[idx] = summary;
  else App.conversations.unshift(summary);
  App.convMeta[conv.id] = summary;
  sortConversations(App.conversations);
  renderConversations();
  updateTitle();
}

function convSummaryFrom(conv) {
  const lastMessage = conv.lastMessage;
  const unread = 0;
  let peer = null;
  if (conv.type === 'private') peer = conv.members.find((m) => m.userId !== App.me.id) || null;
  return {
    id: conv.id,
    type: conv.type,
    name: conv.type === 'group' ? conv.name : peer ? peer.displayName : 'Conversa',
    avatar: conv.type === 'group' ? conv.avatar : peer ? peer.avatar : '',
    peer: peer ? { id: peer.userId, username: peer.username, online: peer.online, lastSeen: peer.lastSeen } : null,
    unread,
    lastMessage,
    lastActivity: lastMessage ? lastMessage.createdAt : conv.createdAt,
    createdAt: conv.createdAt,
    members: conv.members,
  };
}

// ---------- opening a conversation ----------
async function openConversation(convId, opts = {}) {
  if (App.activeConvId === convId && !opts.force) {
    return;
  }
  App.activeConvId = convId;
  App.emojiOpen = false;
  const picker = document.getElementById('emojiPicker');
  if (picker) picker.hidden = true;

  if (!App.convMeta[convId]) {
    try {
      const { conversation } = await API.conversation(convId);
      // O backend não inclui "peer" pronto nessa rota — monta aqui a partir
      // dos membros, senão o avatar/perfil da outra pessoa fica quebrado.
      if (conversation.type === 'private' && !conversation.peer) {
        const peerMember = conversation.members.find((m) => m.userId !== App.me.id);
        if (peerMember) {
          conversation.peer = {
            id: peerMember.userId,
            username: peerMember.username,
            online: peerMember.online,
            lastSeen: peerMember.lastSeen,
          };
        }
      }
      App.convMeta[convId] = conversation;
    } catch (err) {
      App.activeConvId = null;
      toast(err.message, 'error');
      return;
    }
  }

  renderConversations();
  renderChatHeader();
  showChatView();
  applyWallpaper(convId);
  if (!App.messages[convId]) App.messages[convId] = [];
  renderMessages();
  loadMessages(convId);

  document.body.classList.add('view-chat');
}

function showChatView() {
  const empty = document.getElementById('emptyState');
  const chat = document.getElementById('chatView');
  if (empty) empty.hidden = true;
  if (chat) chat.hidden = false;
}

function renderChatHeader() {
  const conv = App.convMeta[App.activeConvId];
  if (!conv) return;
  const name = document.getElementById('chatPeerName');
  const status = document.getElementById('chatPeerStatus');
  const avatarWrap = document.getElementById('chatPeerAvatar');
  // Usa os dados completos do membro (que tem a foto) em vez de conv.peer,
  // que não carrega o avatar — é isso que fazia a foto sumir ao abrir o chat.
  const peerFull = conv.type === 'private' && conv.members
    ? conv.members.find((m) => m.userId !== App.me.id)
    : null;
  const avatar = avatarEl(
    conv.type === 'group' ? { avatar: conv.avatar, displayName: conv.name, username: '' } : peerFull || conv.peer || { displayName: conv.name },
    42
  );
  avatarWrap.innerHTML = '';
  avatarWrap.append(avatar);
  name.textContent = conv.name;

  const subtitle = document.getElementById('chatPeerStatus');
  renderChatStatus();
}

function chatStatusText() {
  const conv = App.convMeta[App.activeConvId];
  if (!conv) return '';
  const typers = App.typing[App.activeConvId];
  if (typers && typers.size) {
    const names = [...typers.keys()].map((userId) => memberName(App.activeConvId, userId));
    return names.length > 1 ? `${names.join(', ')} estão digitando...` : `${names[0]} está digitando...`;
  }
  if (conv.type === 'group') {
    return `${conv.members.length} membros`;
  }
  const peer = conv.peer;
  if (!peer) return '';
  return formatLastSeen(peer.lastSeen, peer.online);
}

function renderChatStatus() {
  const el = document.getElementById('chatPeerStatus');
  if (el) el.textContent = chatStatusText();
}

function memberName(convId, userId) {
  const conv = App.convMeta[convId];
  if (!conv) return 'Alguém';
  const m = conv.members.find((mm) => mm.userId === userId);
  return m ? m.displayName : 'Alguém';
}

async function loadMessages(convId, beforeId) {
  if (App.loadingOlder[convId]) return;
  App.loadingOlder[convId] = true;
  try {
    const { messages } = await API.messages(convId, beforeId);
    if (!beforeId) {
      App.messages[convId] = messages;
      App.hasMore[convId] = messages.length >= 50;
      renderMessages();
      scrollToBottom(true);
    } else {
      App.messages[convId] = [...messages, ...(App.messages[convId] || [])];
      App.hasMore[convId] = messages.length >= 50;
      preserveScrollOnRender();
    }
    const last = App.messages[convId][App.messages[convId].length - 1];
    if (App.activeConvId === convId && last && last.senderId !== App.me.id) {
      ackRead(convId, last.id);
    }
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    App.loadingOlder[convId] = false;
  }
}

// ---------- messages rendering ----------
function messageDom(msg, conv) {
  if (msg.type === 'system') {
    return el('div', { class: 'system-msg', text: msg.content });
  }
  const mine = msg.senderId === App.me.id;
  const bubbleChildren = [];

  if (!mine && conv.type === 'group' && !msg.deleted) {
    const sender = msg.sender || {};
    bubbleChildren.push(el('div', { class: 'msg-sender', style: `color:${senderColor(msg.senderId)}`, text: sender.displayName || '?' }));
  }

  if (msg.deleted) {
    bubbleChildren.push(
      el('span', { class: 'msg-text msg-deleted-text' },
        el('span', { class: 'msg-deleted-ico', html: ICONS.trash }),
        'Mensagem apagada'
      )
    );
  } else if (msg.type === 'image') {
    bubbleChildren.push(el('img', { class: 'msg-image', src: msg.content, loading: 'lazy', alt: 'Foto', onclick: () => openLightbox(msg.content) }));
  } else if (msg.type === 'audio') {
    bubbleChildren.push(el('audio', { class: 'msg-audio', src: msg.content, controls: true, preload: 'metadata' }));
  } else {
    bubbleChildren.push(el('span', { class: 'msg-text', text: msg.content }));
  }

  bubbleChildren.push(
    el('span', { class: 'msg-meta' },
      el('span', { class: 'msg-time', text: formatClock(msg.createdAt) }),
      mine ? statusIconEl(msg) : null
    )
  );

  const bubble = el('div', { class: 'bubble' + (msg.deleted ? ' deleted' : '') }, ...bubbleChildren);
  const row = el('div', {
    class: `msg ${mine ? 'mine' : 'theirs'} ${msg.type}` + (msg.deleted ? ' deleted' : ''),
    'data-mid': msg.id,
    'data-day': startOfDay(msg.createdAt),
  }, bubble);

  if (!msg.deleted && canDeleteMessage(msg, conv)) {
    attachDeleteGesture(row, msg, conv);
  }

  return row;
}

// ---------- apagar mensagem para todos ----------
function canDeleteMessage(msg, conv) {
  if (!msg || msg.type === 'system' || msg.deleted) return false;
  if (msg.senderId === App.me.id) return true;
  const meMember = conv && conv.members && conv.members.find((m) => m.userId === App.me.id);
  return !!(conv && conv.type === 'group' && meMember && meMember.isAdmin);
}

function attachDeleteGesture(row, msg, conv) {
  let pressTimer = null;
  const start = () => {
    pressTimer = setTimeout(() => openDeleteMessageMenu(msg, conv), 480);
  };
  const cancel = () => {
    if (pressTimer) clearTimeout(pressTimer);
    pressTimer = null;
  };
  row.addEventListener('touchstart', start, { passive: true });
  row.addEventListener('touchend', cancel);
  row.addEventListener('touchmove', cancel);
  row.addEventListener('touchcancel', cancel);
  row.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    openDeleteMessageMenu(msg, conv);
  });
}

function openDeleteMessageMenu(msg, conv) {
  const { overlay, box } = modal(
    el('div', { class: 'modal-head' },
      el('h3', { class: 'modal-title', text: 'Apagar mensagem' }),
      el('button', { class: 'icon-btn', onclick: () => closeModal(overlay), html: ICONS.close })
    )
  );
  box.append(
    el('div', { class: 'modal-body' },
      el('p', { text: 'Apagar essa mensagem para todos os participantes da conversa? Ela vai virar "Mensagem apagada" para todo mundo. Essa ação não pode ser desfeita.' })
    ),
    el('div', { class: 'modal-footer' },
      el('button', { class: 'btn btn-block', text: 'Cancelar', onclick: () => closeModal(overlay) }),
      el('button', {
        class: 'btn btn-danger btn-block', text: 'Apagar para todos',
        onclick: async () => {
          try {
            const { message } = await API.deleteMessage(conv.id, msg.id);
            handleMessageDeleted(message);
            closeModal(overlay);
          } catch (err) {
            toast(err.message, 'error');
          }
        },
      })
    )
  );
}

function handleMessageDeleted(msg) {
  const list = App.messages[msg.conversationId];
  if (list) {
    const idx = list.findIndex((m) => m.id === msg.id);
    if (idx >= 0) list[idx] = msg;
  }
  const summary = App.conversations.find((c) => c.id === msg.conversationId);
  if (summary && summary.lastMessage && summary.lastMessage.id === msg.id) {
    summary.lastMessage = msg;
  }
  if (App.activeConvId === msg.conversationId) replaceMessageDom(msg);
  renderConversations();
}

function statusIconEl(msg) {
  const status = computeLocalStatus(msg, App.convMeta[App.activeConvId]);
  const icon = status === 'sent' ? ICONS.check : ICONS.checkDouble;
  const cls = status === 'read' ? 'read' : status === 'delivered' ? 'delivered' : '';
  const title = status === 'read' ? 'Lida' : status === 'delivered' ? 'Entregue' : 'Enviada';
  return el('span', { class: `msg-status ${cls}`, 'data-mid': msg.id, title, html: icon });
}

function computeLocalStatus(msg, conv) {
  if (!msg.senderId || msg.senderId !== App.me.id) return 'sent';
  if (!conv) return 'sent';
  const others = conv.members.filter((m) => m.userId !== msg.senderId);
  if (conv.type === 'private') {
    const other = others[0];
    if (!other) return 'sent';
    if (other.lastReadMessageId >= msg.id) return 'read';
    if (msg.delivered) return 'delivered';
    return 'sent';
  }
  const readCount = others.filter((m) => m.lastReadMessageId >= msg.id).length;
  if (others.length && readCount >= others.length) return 'read';
  if (msg.delivered) return 'delivered';
  return 'sent';
}

function dateSep(ts) {
  return el('div', { class: 'date-sep' }, el('span', { class: 'date-sep-text', text: formatDateLabel(ts) }));
}

function renderMessages() {
  const conv = App.convMeta[App.activeConvId];
  const container = document.getElementById('messages');
  if (!conv || !container) return;
  container.innerHTML = '';
  App.lastMsgDay = null;
  const msgs = App.messages[App.activeConvId] || [];
  let prevDay = null;
  for (const msg of msgs) {
    const day = startOfDay(msg.createdAt);
    if (msg.type !== 'system' && day !== prevDay) {
      container.append(dateSep(msg.createdAt));
      prevDay = day;
    }
    container.append(messageDom(msg, conv));
  }
  updateTypingBubble();
}

function appendNewMessageDom(msg) {
  const conv = App.convMeta[App.activeConvId];
  const container = document.getElementById('messages');
  if (!conv || !container) return;
  const typingBubble = container.querySelector('.typing-indicator');
  if (typingBubble) typingBubble.remove();
  const day = startOfDay(msg.createdAt);
  const lastMsgEl = [...container.querySelectorAll('.msg:not(.typing-indicator)')].pop();
  const lastDay = lastMsgEl ? Number(lastMsgEl.dataset.day) : App.lastMsgDay;
  if (msg.type !== 'system' && day !== lastDay) {
    container.append(dateSep(msg.createdAt));
  }
  container.append(messageDom(msg, conv));
  App.lastMsgDay = day;
  const nearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 180;
  if (nearBottom) scrollToBottom(true);
  updateTypingBubble();
}

function replaceMessageDom(msg) {
  const container = document.getElementById('messages');
  const conv = App.convMeta[App.activeConvId];
  if (!container || !conv) return;
  const existing = container.querySelector(`.msg[data-mid="${msg.id}"]`);
  const nd = messageDom(msg, conv);
  if (existing) existing.replaceWith(nd);
  else appendNewMessageDom(msg);
}

function swapMessageDom(oldId, msg) {
  const container = document.getElementById('messages');
  const conv = App.convMeta[App.activeConvId];
  if (!container || !conv) return;
  const existing = container.querySelector(`.msg[data-mid="${oldId}"]`);
  if (existing) existing.replaceWith(messageDom(msg, conv));
  else appendNewMessageDom(msg);
}

function updateStatuses() {
  const container = document.getElementById('messages');
  const conv = App.convMeta[App.activeConvId];
  if (!container || !conv) return;
  const msgs = App.messages[App.activeConvId] || [];
  for (const msg of msgs) {
    if (!msg.senderId || msg.senderId !== App.me.id) continue;
    const span = container.querySelector(`.msg-status[data-mid="${msg.id}"]`);
    if (span) span.replaceWith(statusIconEl(msg));
  }
}

function scrollToBottom(smooth) {
  const container = document.getElementById('messages');
  if (!container) return;
  container.scrollTop = container.scrollHeight;
}

function preserveScrollOnRender() {
  const container = document.getElementById('messages');
  if (!container) return;
  const prevHeight = container.scrollHeight;
  const prevTop = container.scrollTop;
  renderMessages();
  container.scrollTop = container.scrollHeight - prevHeight + prevTop;
}

// ---------- sending ----------
function currentInputText() {
  const input = document.getElementById('msgInput');
  return input ? input.value.trim() : '';
}

async function sendTextMessage() {
  const content = currentInputText();
  if (!content) return;
  if (!App.activeConvId) return;
  const input = document.getElementById('msgInput');
  input.value = '';
  autoResize(input);
  updateComposerButtons();

  const tempId = 'local-' + Date.now();
  const temp = {
    id: tempId,
    conversationId: App.activeConvId,
    senderId: App.me.id,
    type: 'text',
    content,
    createdAt: Date.now(),
    status: 'sent',
    sender: { id: App.me.id, username: App.me.username, displayName: App.me.displayName, avatar: App.me.avatar },
  };
  App.messages[App.activeConvId].push(temp);
  appendNewMessageDom(temp);
  playSentSound();

  try {
    const { message } = await API.sendMessage(App.activeConvId, 'text', content);
    if (message) {
      const idx = App.messages[App.activeConvId].indexOf(temp);
      if (idx >= 0) {
        // O evento em tempo real ainda não chegou: somos nós que fazemos a troca.
        App.messages[App.activeConvId][idx] = message;
        swapMessageDom(tempId, message);
      }
      // Se idx < 0, o evento em tempo real (handleMessageNew) já substituiu a
      // mensagem temporária pela definitiva — não fazer nada de novo aqui,
      // senão o mesmo balão é inserido uma segunda vez na tela.
    }
  } catch (err) {
    toast(err.message, 'error');
    App.messages[App.activeConvId] = App.messages[App.activeConvId].filter((m) => m.id !== tempId);
    const container = document.getElementById('messages');
    if (container) container.querySelector(`.msg[data-mid="${tempId}"]`)?.remove();
  }
}

async function sendMediaMessage(type, content) {
  if (!App.activeConvId) return;
  try {
    const { message } = await API.sendMessage(App.activeConvId, type, content);
    playSentSound();
    if (message) {
      if (!App.messages[App.activeConvId]) App.messages[App.activeConvId] = [];
      const list = App.messages[App.activeConvId];
      // O evento em tempo real (handleMessageNew) pode chegar antes desta resposta
      // e já ter inserido essa mesma mensagem — só adiciona se ainda não estiver lá,
      // senão a foto/áudio aparece duplicada na tela.
      if (!list.some((m) => m.id === message.id)) {
        list.push(message);
        appendNewMessageDom(message);
      }
    }
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ---------- read ack ----------
function ackRead(convId, messageId) {
  if (Socket.socket && messageId) {
    Socket.socket.emit('read', { conversationId: convId, messageId });
  }
  const c = App.conversations.find((cc) => cc.id === convId);
  if (c && c.unread) {
    c.unread = 0;
    renderConversations();
    updateTitle();
  }
  const meta = App.convMeta[convId];
  if (meta) {
    const mine = meta.members.find((m) => m.userId === App.me.id);
    if (mine && messageId && mine.lastReadMessageId < messageId) mine.lastReadMessageId = messageId;
  }
}

// ---------- realtime handlers ----------
function handleMessageNew(msg) {
  const conv = App.convMeta[msg.conversationId];
  if (!App.messages[msg.conversationId]) App.messages[msg.conversationId] = [];
  const list = App.messages[msg.conversationId];
  if (list.some((m) => m.id === msg.id)) return;

  const fromMe = msg.senderId === App.me.id;
  const summary = App.conversations.find((c) => c.id === msg.conversationId);
  if (!summary) {
    loadConversations();
  } else {
    summary.lastMessage = msg;
    summary.lastActivity = msg.createdAt;
    if (summary.type === 'private' && summary.peer) {
      const pm = conv ? conv.members.find((m) => m.userId === summary.peer.id) : null;
      if (pm) summary.name = pm.displayName;
    }
  }

  const isActive = App.activeConvId === msg.conversationId;

  if (!fromMe) {
    playReceivedSound();
  }

  if (!isActive && !fromMe) {
    if (summary) summary.unread += 1;
    const sender = msg.sender || {};
    const notif = {
      id: msg.id,
      conversationId: msg.conversationId,
      title: summary ? summary.name : (msg.sender && msg.sender.displayName) || 'Pulse',
      body: messagePreviewText(msg, App.me.id),
      ts: msg.createdAt,
    };
    App.notifications.unshift(notif);
    App.notifications = App.notifications.slice(0, 30);
    refreshNotifBadge();
    toast(`${notif.title}: ${notif.body}`, 'info');
    notifyBrowser(notif);
  }

  sortConversations(App.conversations);
  renderConversations();
  updateTitle();

  if (isActive) {
    const list = App.messages[msg.conversationId];
    const tempIdx = list.findIndex((m) => String(m.id).startsWith('local-'));
    if (fromMe && tempIdx >= 0) {
      const oldId = list[tempIdx].id;
      list[tempIdx] = msg;
      swapMessageDom(oldId, msg);
      return;
    }
    list.push(msg);
    appendNewMessageDom(msg);
    if (!fromMe) ackRead(msg.conversationId, msg.id);
  }
}

function handleRead(data) {
  const conv = App.convMeta[data.conversationId];
  if (!conv) return;
  const member = conv.members.find((m) => m.userId === data.userId);
  if (member) member.lastReadMessageId = Math.max(member.lastReadMessageId, data.lastReadMessageId);
  const summary = App.conversations.find((c) => c.id === data.conversationId);
  if (summary && data.userId === App.me.id && summary.unread) {
    summary.unread = 0;
    renderConversations();
    updateTitle();
  }
  if (App.activeConvId === data.conversationId) {
    updateStatuses();
    renderConversations();
  }
}

function handleTyping(data) {
  if (data.userId === App.me.id) return;
  if (!App.typing[data.conversationId]) App.typing[data.conversationId] = new Map();
  const map = App.typing[data.conversationId];
  const existing = map.get(data.userId);
  if (existing) clearTimeout(existing);
  if (data.isTyping) {
    map.set(data.userId, setTimeout(() => {
      map.delete(data.userId);
      renderChatStatus();
      renderConversations();
      if (App.activeConvId === data.conversationId) updateTypingBubble();
    }, 3500));
  } else {
    map.delete(data.userId);
  }
  if (App.activeConvId === data.conversationId) {
    renderChatStatus();
    updateTypingBubble();
  }
  renderConversations();
}

function typingDotsEl() {
  return el('div', { class: 'msg theirs typing-indicator' },
    el('div', { class: 'bubble typing-bubble' },
      el('span', { class: 'typing-dot' }),
      el('span', { class: 'typing-dot' }),
      el('span', { class: 'typing-dot' })
    )
  );
}

function updateTypingBubble() {
  const container = document.getElementById('messages');
  if (!container) return;
  const existing = container.querySelector('.typing-indicator');
  const isTyping = isTypingIn(App.activeConvId);
  if (isTyping && !existing) {
    const nearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 180;
    container.append(typingDotsEl());
    if (nearBottom) scrollToBottom(true);
  } else if (!isTyping && existing) {
    existing.remove();
  }
}

function handlePresence(data) {
  for (const c of App.conversations) {
    if (c.type === 'private' && c.peer && c.peer.id === data.userId) {
      c.peer.online = data.online;
      c.peer.lastSeen = data.lastSeen || c.peer.lastSeen;
    }
    const m = c.members.find((mm) => mm.userId === data.userId);
    if (m) {
      m.online = data.online;
      m.lastSeen = data.lastSeen || m.lastSeen;
    }
  }
  if (App.convMeta[App.activeConvId]) {
    const meta = App.convMeta[App.activeConvId];
    const mm = meta.members.find((m) => m.userId === data.userId);
    if (mm) {
      mm.online = data.online;
      mm.lastSeen = data.lastSeen || mm.lastSeen;
    }
    if (meta.type === 'private' && meta.peer && meta.peer.id === data.userId) {
      meta.peer.online = data.online;
      meta.peer.lastSeen = data.lastSeen || meta.peer.lastSeen;
    }
  }
  renderConversations();
  renderChatStatus();
}

function handleConversationUpdate(summary) {
  const idx = App.conversations.findIndex((c) => c.id === summary.id);
  if (idx >= 0) App.conversations[idx] = summary;
  else App.conversations.unshift(summary);
  App.convMeta[summary.id] = summary;
  renderConversations();
  if (App.activeConvId === summary.id) renderChatHeader();
}

function handleConversationNew(data) {
  if (data.forUserIds && data.forUserIds.includes(App.me.id)) {
    loadConversations();
  }
}

// ---------- presence emit ----------
function emitTyping(isTyping) {
  if (!App.activeConvId || !Socket.socket) return;
  Socket.socket.emit('typing', { conversationId: App.activeConvId, isTyping });
}

// ---------- title & badges ----------
function updateTitle() {
  const total = App.conversations.reduce((acc, c) => acc + (c.unread || 0), 0);
  document.title = total ? `(${total}) Pulse` : 'Pulse';
  const badge = document.querySelector('.notif-btn .notif-badge');
  if (badge) {
    badge.textContent = total > 99 ? '99+' : total;
    badge.hidden = total === 0;
  }
}

function refreshNotifBadge() {
  const unreadNotifs = App.notifications.filter((n) => !n.read).length;
  const badge = document.querySelector('.notif-btn .notif-badge');
  if (badge) {
    const total = App.conversations.reduce((acc, c) => acc + (c.unread || 0), 0) + unreadNotifs;
    badge.textContent = total > 99 ? '99+' : total;
    badge.hidden = total === 0;
  }
}

// ---------- wire shell events ----------
function wireShellEvents() {
  const searchInput = document.getElementById('searchInput');
  searchInput.addEventListener('input', debounce(() => {
    App.searchQuery = searchInput.value.trim();
    if (App.searchQuery.length >= 2) {
      API.searchUsers(App.searchQuery)
        .then((res) => {
          App.userResults = res || [];
          renderConversations();
        })
        .catch(() => {});
    } else {
      App.userResults = [];
      renderConversations();
    }
    renderConversations();
  }, 250));

  const btnNewChat = document.getElementById('btnNewChat');
  btnNewChat.addEventListener('click', openNewChatModal);

  const btnNotif = document.getElementById('btnNotif');
  btnNotif.addEventListener('click', (e) => {
    e.stopPropagation();
    openNotifDropdown(btnNotif);
  });

  const btnMe = document.getElementById('btnMe');
  btnMe.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleMeMenu(btnMe);
  });

  document.addEventListener('click', () => {
    const menu = document.getElementById('meMenu');
    if (menu) menu.hidden = true;
    const notif = document.getElementById('notifDropdown');
    if (notif) notif.remove();
    const picker = document.getElementById('emojiPicker');
    if (picker && App.emojiOpen) {
      picker.hidden = true;
      App.emojiOpen = false;
    }
  });

  // chat events
  const msgInput = document.getElementById('msgInput');
  const btnSend = document.getElementById('btnSend');
  const btnMic = document.getElementById('btnMic');

  msgInput.addEventListener('input', () => {
    autoResize(msgInput);
    updateComposerButtons();
  });

  msgInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendTextMessage();
    }
  });

  let typingTimeout = null;
  msgInput.addEventListener('keydown', () => {
    emitTyping(true);
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => emitTyping(false), 1800);
  });

  btnSend.addEventListener('click', sendTextMessage);
  btnMic.addEventListener('click', () => {
    if (App.isRecording) stopRecording(true);
    else startRecording();
  });

  document.getElementById('btnBack').addEventListener('click', () => {
    document.body.classList.remove('view-chat');
    emitTyping(false);
    App.activeConvId = null;
    renderConversations();
  });

  document.getElementById('btnChatInfo').addEventListener('click', openChatInfo);

  document.getElementById('chatPeerBtn').addEventListener('click', openChatInfo);

  document.getElementById('btnEmoji').addEventListener('click', (e) => {
    e.stopPropagation();
    toggleEmojiPicker();
  });

  document.getElementById('btnAttach').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast('Envie uma imagem válida.', 'error');
      return;
    }
    toast('Enviando imagem...');
    try {
      const { url } = await API.upload(file);
      await sendMediaMessage('image', url);
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  const messagesEl = document.getElementById('messages');
  messagesEl.addEventListener('scroll', () => {
    const convId = App.activeConvId;
    if (!convId) return;
    if (messagesEl.scrollTop < 120 && App.hasMore[convId] && !App.loadingOlder[convId]) {
      const first = App.messages[convId] && App.messages[convId][0];
      if (first) loadMessages(convId, first.id);
    }
  });

  document.getElementById('btnCancelRec').addEventListener('click', () => stopRecording(false));
  document.getElementById('btnSendRec').addEventListener('click', () => stopRecording(true));
}

function autoResize(textarea) {
  textarea.style.height = 'auto';
  textarea.style.height = Math.min(textarea.scrollHeight, 140) + 'px';
}

function updateComposerButtons() {
  const hasText = currentInputText().length > 0;
  const send = document.getElementById('btnSend');
  const mic = document.getElementById('btnMic');
  if (send && mic) {
    send.hidden = !hasText;
    mic.hidden = hasText;
  }
}

function toggleEmojiPicker() {
  const picker = document.getElementById('emojiPicker');
  App.emojiOpen = !App.emojiOpen;
  picker.hidden = !App.emojiOpen;
  if (App.emojiOpen && !picker.children.length) {
    picker.addEventListener('click', (e) => e.stopPropagation());
    const grid = el('div', { class: 'emoji-grid' });
    for (const emoji of EMOJIS) {
      grid.append(el('button', { class: 'emoji-cell', type: 'button', text: emoji }));
    }
    picker.append(grid);
    picker.addEventListener('click', (e) => {
      const cell = e.target.closest('.emoji-cell');
      if (!cell) return;
      const input = document.getElementById('msgInput');
      const start = input.selectionStart || input.value.length;
      const end = input.selectionEnd || input.value.length;
      input.value = input.value.slice(0, start) + cell.textContent + input.value.slice(end);
      input.focus();
      input.selectionStart = input.selectionEnd = start + cell.textContent.length;
      autoResize(input);
      updateComposerButtons();
    });
  }
}

// ---------- audio recording ----------
async function startRecording() {
  if (App.isRecording) return;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeType = pickRecorderMime();
    const mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    App.record = { mediaRecorder, chunks: [], stream, seconds: 0, timer: null };
    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size) App.record.chunks.push(e.data);
    };
    mediaRecorder.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      const type = App.record.mediaRecorder.mimeType || 'audio/webm';
      const blob = new Blob(App.record.chunks, { type });
      const url = URL.createObjectURL(blob);
      if (App.record.sendOnStop) {
        await sendVoiceBlob(blob);
        URL.revokeObjectURL(url);
      }
      showComposer();
      App.record = { mediaRecorder: null, chunks: [], stream: null, seconds: 0, timer: null };
    };
    mediaRecorder.start();
    App.isRecording = true;
    App.record.sendOnStop = false;
    showRecordingUI();
  } catch (_e) {
    toast('Não foi possível acessar o microfone.', 'error');
  }
}

function pickRecorderMime() {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(c)) return c;
  }
  return '';
}

function showRecordingUI() {
  const recWrap = document.getElementById('recWrap');
  const msgInput = document.getElementById('msgInput');
  recWrap.hidden = false;
  msgInput.hidden = true;
  const btnMic = document.getElementById('btnMic');
  btnMic.classList.add('recording');
  btnMic.title = 'Parar gravação';
  updateRecTimer();
}

function showComposer() {
  const recWrap = document.getElementById('recWrap');
  const msgInput = document.getElementById('msgInput');
  recWrap.hidden = true;
  msgInput.hidden = false;
  const btnMic = document.getElementById('btnMic');
  btnMic.classList.remove('recording');
  btnMic.title = 'Gravar áudio';
  if (App.record.timer) {
    clearInterval(App.record.timer);
    App.record.timer = null;
  }
}

function updateRecTimer() {
  const label = document.getElementById('recTimer');
  const start = Date.now();
  const tick = () => {
    const s = Math.floor((Date.now() - start) / 1000);
    label.textContent = `${Math.floor(s / 60)}:${two(s % 60)}`;
  };
  tick();
  App.record.timer = setInterval(tick, 250);
}

function stopRecording(send) {
  if (!App.isRecording || !App.record.mediaRecorder) return;
  App.record.sendOnStop = send;
  try {
    if (App.record.mediaRecorder.state !== 'inactive') App.record.mediaRecorder.stop();
  } catch (_e) {
    /* noop */
  }
  App.isRecording = false;
}

async function sendVoiceBlob(blob) {
  if (!App.activeConvId) return;
  toast('Enviando áudio...');
  try {
    const { url } = await API.upload(blob, blob.type || 'audio/webm');
    await sendMediaMessage('audio', url);
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ---------- menus / dropdowns ----------
function toggleMeMenu(btn) {
  const menu = document.getElementById('meMenu');
  const existing = menu;
  existing.innerHTML = '';
  existing.hidden = !existing.hidden;
  if (existing.hidden) return;
  existing.append(
    menuItem('Meu perfil', ICONS.user, () => { existing.hidden = true; openProfileModal(); }),
    menuItem('Configurações', ICONS.settings, () => { existing.hidden = true; openSettingsModal(); }),
    menuItem('Sair', ICONS.logout, () => { existing.hidden = true; logout(); })
  );
}

function menuItem(label, icon, onClick) {
  return el('button', { class: 'menu-item', type: 'button', onclick: onClick },
    el('span', { class: 'menu-ico', html: icon }),
    el('span', { text: label })
  );
}

function openNotifDropdown(anchor) {
  const existing = document.getElementById('notifDropdown');
  if (existing) {
    existing.remove();
    return;
  }
  const dd = el('div', { class: 'notif-dropdown', id: 'notifDropdown' });
  if (!App.notifications.length) {
    dd.append(el('div', { class: 'notif-empty', text: 'Nenhuma notificação por enquanto.' }));
  } else {
    for (const n of App.notifications) {
      n.read = true;
      dd.append(el('button', {
        class: 'notif-item', type: 'button',
        onclick: () => { dd.remove(); openConversation(n.conversationId); },
      },
        el('div', { class: 'notif-title', text: n.title }),
        el('div', { class: 'notif-body', text: n.body }),
        el('div', { class: 'notif-time', text: formatConvTime(n.ts) })
      ));
    }
  }
  document.body.append(dd);
  const rect = anchor.getBoundingClientRect();
  dd.style.top = rect.bottom + 8 + 'px';
  dd.style.right = Math.max(8, window.innerWidth - rect.right) + 'px';
  refreshNotifBadge();
}

// ---------- modals ----------
function openNewChatModal() {
  const { overlay, box } = modal(
    el('div', { class: 'modal-head' },
      el('h3', { class: 'modal-title', text: 'Nova conversa' }),
      el('button', { class: 'icon-btn', onclick: () => closeModal(overlay), html: ICONS.close })
    )
  );
  box.classList.add('modal-newchat');

  const tabs = el('div', { class: 'tabs' },
    el('button', { class: 'tab active', type: 'button', 'data-tab': 'person', text: 'Pessoa' }),
    el('button', { class: 'tab', type: 'button', 'data-tab': 'group', text: 'Grupo' })
  );
  const body = el('div', { class: 'modal-body' });
  box.append(tabs, body);

  let current = 'person';
  function renderTab() {
    body.innerHTML = '';
    if (current === 'person') renderPersonTab(body, overlay);
    else renderGroupTab(body, overlay);
    tabs.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === current));
  }
  tabs.addEventListener('click', (e) => {
    const t = e.target.closest('.tab');
    if (t) {
      current = t.dataset.tab;
      renderTab();
    }
  });
  renderTab();
}

function renderPersonTab(body, overlay) {
  const search = el('div', { class: 'modal-search' },
    el('span', { class: 'search-ico', html: ICONS.search }),
    el('input', { class: 'input', id: 'newChatSearch', placeholder: 'Buscar por nome de usuário' })
  );
  const results = el('div', { class: 'user-results' });
  results.append(el('div', { class: 'list-empty', text: 'Digite para buscar usuários.' }));
  body.append(search, results);

  const run = debounce(async () => {
    const q = search.querySelector('input').value.trim();
    if (q.length < 2) {
      results.innerHTML = '';
      results.append(el('div', { class: 'list-empty', text: 'Digite ao menos 2 caracteres.' }));
      return;
    }
    try {
      const users = await API.searchUsers(q);
      results.innerHTML = '';
      if (!users.length) {
        results.append(el('div', { class: 'list-empty', text: 'Nenhum usuário encontrado.' }));
        return;
      }
      for (const u of users) {
        results.append(el('button', {
          class: 'user-row', type: 'button',
          onclick: async () => {
            try {
              const { conversation } = await API.createPrivate(u.id);
              closeModal(overlay);
              upsertConversation(conversation);
              openConversation(conversation.id);
            } catch (err) {
              toast(err.message, 'error');
            }
          },
        },
          avatarEl(u, 42, { showOnline: true, online: u.online }),
          el('div', { class: 'user-row-info' },
            el('div', { class: 'user-row-name', text: u.displayName }),
            el('div', { class: 'user-row-uname', text: '@' + u.username })
          )
        ));
      }
    } catch (err) {
      toast(err.message, 'error');
    }
  }, 250);
  search.querySelector('input').addEventListener('input', run);
  search.querySelector('input').focus();
}

function renderGroupTab(body, overlay) {
  const nameField = el('div', { class: 'field' },
    el('label', { class: 'field-label', text: 'Nome do grupo' }),
    el('input', { class: 'input', id: 'groupName', placeholder: 'Ex: Equipe Pulse' })
  );
  const search = el('div', { class: 'modal-search' },
    el('span', { class: 'search-ico', html: ICONS.search }),
    el('input', { class: 'input', id: 'groupSearch', placeholder: 'Buscar participantes' })
  );
  const selectedWrap = el('div', { class: 'selected-wrap', id: 'selectedWrap' });
  const results = el('div', { class: 'user-results' });
  const footer = el('div', { class: 'modal-footer' },
    el('button', { class: 'btn btn-primary btn-block', id: 'btnCreateGroup', text: 'Criar grupo' })
  );
  body.append(nameField, selectedWrap, search, results, footer);

  const selected = new Set();
  const chips = {};
  function renderSelected() {
    selectedWrap.innerHTML = '';
    for (const u of [...selected.values()]) {
      const chip = el('span', { class: 'member-chip' },
        avatarEl(u, 26),
        el('span', { class: 'chip-name', text: u.displayName }),
        el('button', { class: 'chip-x', type: 'button', html: ICONS.close, onclick: () => { selected.delete(u); renderSelected(); } })
      );
      selectedWrap.append(chip);
    }
  }

  search.querySelector('input').addEventListener('input', debounce(async () => {
    const q = search.querySelector('input').value.trim();
    if (q.length < 2) return;
    try {
      const users = await API.searchUsers(q);
      results.innerHTML = '';
      for (const u of users) {
        const isSel = [...selected.values()].some((s) => s.id === u.id);
        const row = el('button', {
          class: 'user-row' + (isSel ? ' selected' : ''), type: 'button',
          onclick: () => {
            if (isSel) selected.delete(u);
            else selected.add(u);
            renderSelected();
            renderGroupSearchResults(users);
          },
        },
          avatarEl(u, 42),
          el('div', { class: 'user-row-info' },
            el('div', { class: 'user-row-name', text: u.displayName }),
            el('div', { class: 'user-row-uname', text: '@' + u.username })
          ),
          el('span', { class: 'row-check', text: isSel ? '✓' : '' })
        );
        results.append(row);
      }
    } catch (err) {
      toast(err.message, 'error');
    }
  }, 250));

  function renderGroupSearchResults(users) {
    results.innerHTML = '';
    for (const u of users) {
      const isSel = [...selected.values()].some((s) => s.id === u.id);
      results.append(el('button', {
        class: 'user-row' + (isSel ? ' selected' : ''), type: 'button',
        onclick: () => {
          if (isSel) selected.delete(u);
          else selected.add(u);
          renderSelected();
          renderGroupSearchResults(users);
        },
      },
        avatarEl(u, 42),
        el('div', { class: 'user-row-info' },
          el('div', { class: 'user-row-name', text: u.displayName }),
          el('div', { class: 'user-row-uname', text: '@' + u.username })
        ),
        el('span', { class: 'row-check', text: isSel ? '✓' : '' })
      ));
    }
  }

  footer.querySelector('#btnCreateGroup').addEventListener('click', async () => {
    const name = nameField.querySelector('input').value.trim();
    if (!name) return toast('Dê um nome ao grupo.', 'error');
    if (!selected.size) return toast('Selecione ao menos um participante.', 'error');
    const btn = footer.querySelector('#btnCreateGroup');
    btn.disabled = true;
    try {
      const { conversation } = await API.createGroup(name, [...selected.values()].map((u) => u.id));
      closeModal(overlay);
      upsertConversation(conversation);
      openConversation(conversation.id);
    } catch (err) {
      toast(err.message, 'error');
      btn.disabled = false;
    }
  });
}

function openChatInfo() {
  const conv = App.convMeta[App.activeConvId];
  if (!conv) return;
  if (conv.type === 'private') openPrivateInfo(conv);
  else openGroupInfo(conv);
}

function openPrivateInfo(conv) {
  const peer = conv.peer;
  if (!peer) return;
  const { overlay, box } = modal(
    el('div', { class: 'modal-head' },
      el('h3', { class: 'modal-title', text: 'Perfil' }),
      el('button', { class: 'icon-btn', onclick: () => closeModal(overlay), html: ICONS.close })
    )
  );
  box.classList.add('modal-profile');
  const peerFull = conv.members.find((m) => m.userId === peer.id) || peer;
  if (peerFull.cover) {
    box.append(el('div', { class: 'profile-cover', style: `background-image:url('${peerFull.cover}')` }));
  }
  box.append(
    el('div', { class: 'profile-hero' },
      el('div', { class: 'profile-avatar' }, avatarEl(peerFull, 96, { showOnline: true, online: peer.online })),
      el('h3', { class: 'profile-name', text: peerFull.displayName }),
      el('div', { class: 'profile-uname', text: '@' + peerFull.username }),
      el('div', { class: 'profile-status', text: formatLastSeen(peer.lastSeen, peer.online) })
    ),
    peerFull.bio ? el('div', { class: 'profile-bio', text: peerFull.bio }) : el('div', { class: 'profile-bio muted', text: 'Sem bio.' }),
    el('div', { class: 'modal-footer' },
      el('button', {
        class: 'btn btn-primary btn-block', text: 'Enviar mensagem',
        onclick: () => { closeModal(overlay); openConversation(conv.id); },
      }),
      el('button', {
        class: 'btn btn-block', text: '🖼️ Papel de parede da conversa',
        onclick: () => openWallpaperPicker(conv.id),
      }),
      el('button', {
        class: 'btn btn-danger btn-block', text: 'Apagar conversa',
        onclick: () => confirmDeleteConversation(conv, overlay),
      })
    )
  );
}

// ---------- apagar conversa ----------
function confirmDeleteConversation(conv, infoOverlay) {
  const { overlay, box } = modal(
    el('div', { class: 'modal-head' },
      el('h3', { class: 'modal-title', text: 'Apagar conversa' }),
      el('button', { class: 'icon-btn', onclick: () => closeModal(overlay), html: ICONS.close })
    )
  );
  box.append(
    el('div', { class: 'modal-body' },
      el('p', { text: 'Isso vai apagar essa conversa e todas as mensagens dela, para todos os participantes. Essa ação não pode ser desfeita.' })
    ),
    el('div', { class: 'modal-footer' },
      el('button', { class: 'btn btn-block', text: 'Cancelar', onclick: () => closeModal(overlay) }),
      el('button', {
        class: 'btn btn-danger btn-block', text: 'Apagar',
        onclick: async () => {
          try {
            await API.deleteConversation(conv.id);
            closeModal(overlay);
            if (infoOverlay) closeModal(infoOverlay);
            removeConversationFromView(conv.id);
          } catch (err) {
            toast(err.message, 'error');
          }
        },
      })
    )
  );
}

function removeConversationFromView(convId) {
  App.conversations = App.conversations.filter((c) => c.id !== convId);
  delete App.convMeta[convId];
  delete App.messages[convId];
  if (App.activeConvId === convId) {
    App.activeConvId = null;
    document.getElementById('chatView').hidden = true;
    document.getElementById('emptyState').hidden = false;
    document.body.classList.remove('view-chat');
  }
  renderConversations();
  updateTitle();
}

function openGroupInfo(conv) {
  const { overlay, box } = modal(
    el('div', { class: 'modal-head' },
      el('h3', { class: 'modal-title', text: 'Detalhes do grupo' }),
      el('button', { class: 'icon-btn', onclick: () => closeModal(overlay), html: ICONS.close })
    )
  );
  box.classList.add('modal-profile');
  const meMember = conv.members.find((m) => m.userId === App.me.id);
  const isAdmin = meMember && meMember.isAdmin;

  const body = el('div', { class: 'modal-body' });
  const groupAvatarWrap = el('div', { class: 'profile-avatar' }, avatarEl({ avatar: conv.avatar, displayName: conv.name, username: '' }, 96));
  const heroChildren = [
    groupAvatarWrap,
    el('h3', { class: 'profile-name', text: conv.name }),
    el('div', { class: 'profile-status', text: `${conv.members.length} membros` }),
  ];
  if (isAdmin) {
    const hiddenFile = el('input', { type: 'file', accept: 'image/*', hidden: true });
    const avatarBtn = el('button', { class: 'avatar-edit', type: 'button', title: 'Trocar foto do grupo' },
      el('span', { class: 'avatar-edit-ico', html: ICONS.camera }));
    avatarBtn.addEventListener('click', () => hiddenFile.click());
    hiddenFile.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      e.target.value = '';
      if (!file || !file.type.startsWith('image/')) return;
      try {
        const { url } = await API.upload(file);
        const { conversation } = await API.updateGroupAvatar(conv.id, url);
        App.convMeta[conversation.id] = conversation;
        conv.avatar = conversation.avatar;
        groupAvatarWrap.innerHTML = '';
        groupAvatarWrap.append(avatarEl({ avatar: conv.avatar, displayName: conv.name, username: '' }, 96));
        renderConversations();
        if (App.activeConvId === conv.id) renderChatHeader();
        toast('Foto do grupo atualizada');
      } catch (err) {
        toast(err.message, 'error');
      }
    });
    heroChildren.push(hiddenFile, avatarBtn);
  }
  body.append(el('div', { class: 'profile-hero' }, ...heroChildren));

  const memberList = el('div', { class: 'group-members' });
  function renderMembers() {
    memberList.innerHTML = '';
    body.querySelectorAll('.group-members').forEach(() => {});
    memberList.append(el('h4', { class: 'section-head', text: 'Membros' }));
    for (const m of conv.members) {
      memberList.append(el('div', { class: 'member-row' },
        avatarEl(m, 38, { showOnline: true, online: m.online }),
        el('div', { class: 'user-row-info' },
          el('div', { class: 'user-row-name', text: m.displayName + (m.isAdmin ? '  👑' : '') }),
          el('div', { class: 'user-row-uname', text: '@' + m.username + (m.userId === App.me.id ? '  (você)' : '') })
        )
      ));
    }
    if (isAdmin) {
      memberList.append(
        el('div', { class: 'modal-search' },
          el('span', { class: 'search-ico', html: ICONS.search }),
          el('input', { class: 'input', id: 'addMemberSearch', placeholder: 'Adicionar participante' })
        )
      );
      const addResults = el('div', { class: 'user-results' });
      memberList.append(addResults);
      memberList.querySelector('#addMemberSearch').addEventListener('input', debounce(async () => {
        const q = memberList.querySelector('#addMemberSearch').value.trim();
        if (q.length < 2) return;
        try {
          const users = await API.searchUsers(q);
          addResults.innerHTML = '';
          for (const u of users) {
            if (conv.members.some((m) => m.userId === u.id)) continue;
            addResults.append(el('button', {
              class: 'user-row', type: 'button',
              onclick: async () => {
                try {
                  const { conversation } = await API.addGroupMember(conv.id, u.id);
                  App.convMeta[conv.id] = conversation;
                  openGroupInfo(conversation);
                  overlay.remove();
                } catch (err) {
                  toast(err.message, 'error');
                }
              },
            },
              avatarEl(u, 38),
              el('div', { class: 'user-row-info' },
                el('div', { class: 'user-row-name', text: u.displayName }),
                el('div', { class: 'user-row-uname', text: '@' + u.username })
              )
            ));
          }
        } catch (err) {
          toast(err.message, 'error');
        }
      }, 250));
    }
  }
  renderMembers();
  body.append(memberList);

  const footerButtons = [
    el('button', {
      class: 'btn btn-block', text: '🖼️ Papel de parede da conversa',
      onclick: () => openWallpaperPicker(conv.id),
    }),
    el('button', {
      class: 'btn btn-danger btn-block', text: 'Sair do grupo',
      onclick: async () => {
        try {
          await API.leaveGroup(conv.id);
          closeModal(overlay);
          removeConversationFromView(conv.id);
        } catch (err) {
          toast(err.message, 'error');
        }
      },
    }),
  ];
  if (isAdmin) {
    footerButtons.push(el('button', {
      class: 'btn btn-danger btn-block', text: 'Apagar conversa para todos',
      onclick: () => confirmDeleteConversation(conv, overlay),
    }));
  }

  box.append(
    body,
    el('div', { class: 'modal-footer' }, ...footerButtons)
  );
}

function openProfileModal() {
  const u = App.me;
  const { overlay, box } = modal(
    el('div', { class: 'modal-head' },
      el('h3', { class: 'modal-title', text: 'Meu perfil' }),
      el('button', { class: 'icon-btn', onclick: () => closeModal(overlay), html: ICONS.close })
    )
  );
  box.classList.add('modal-profile');
  box.append(
    el('div', { class: 'profile-hero' },
      el('div', { class: 'profile-avatar' }, avatarEl(u, 96, { showOnline: true, online: u.online })),
      el('h3', { class: 'profile-name', text: u.displayName }),
      el('div', { class: 'profile-uname', text: '@' + u.username })
    ),
    u.bio ? el('div', { class: 'profile-bio', text: u.bio }) : el('div', { class: 'profile-bio muted', text: 'Sem bio.' }),
    el('div', { class: 'modal-footer' },
      el('button', {
        class: 'btn btn-primary btn-block', text: 'Editar perfil',
        onclick: () => { closeModal(overlay); openSettingsModal(); },
      })
    )
  );
}

function openSettingsModal() {
  const { overlay, box } = modal(
    el('div', { class: 'modal-head' },
      el('h3', { class: 'modal-title', text: 'Configurações' }),
      el('button', { class: 'icon-btn', onclick: () => closeModal(overlay), html: ICONS.close })
    )
  );
  box.classList.add('modal-profile');

  const coverWrap = el('div', {
    class: 'profile-cover',
    style: App.me.cover ? `background-image:url('${App.me.cover}')` : '',
  });
  const coverFile = el('input', { type: 'file', accept: 'image/*', hidden: true });
  const coverBtn = el('button', { class: 'cover-edit', type: 'button', title: 'Trocar foto de capa' },
    el('span', { class: 'avatar-edit-ico', html: ICONS.camera }), ' Capa');
  coverBtn.addEventListener('click', () => coverFile.click());
  coverFile.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file || !file.type.startsWith('image/')) return;
    try {
      const { url } = await API.upload(file);
      const { user } = await API.updateMe({ cover: url });
      App.me = user;
      coverWrap.style.backgroundImage = `url('${url}')`;
      toast('Foto de capa atualizada');
    } catch (err) {
      toast(err.message, 'error');
    }
  });
  coverWrap.append(coverFile, coverBtn);

  const avatarWrap = el('div', { class: 'profile-avatar settings-avatar' }, avatarImg(App.me, 96));
  const hiddenFile = el('input', { type: 'file', accept: 'image/*', hidden: true });
  const avatarBtn = el('button', { class: 'avatar-edit', type: 'button', title: 'Trocar foto' },
    el('span', { class: 'avatar-edit-ico', html: ICONS.camera }));
  avatarBtn.addEventListener('click', () => hiddenFile.click());
  hiddenFile.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file || !file.type.startsWith('image/')) return;
    try {
      const { url } = await API.upload(file);
      const { user } = await API.updateMe({ avatar: url });
      App.me = user;
      avatarWrap.innerHTML = '';
      avatarWrap.append(avatarImg(App.me, 96));
      refreshMeUI();
      toast('Foto atualizada');
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  const form = el('form', { class: 'auth-form settings-form' },
    el('div', { class: 'field' },
      el('label', { class: 'field-label', text: 'Nome de exibição' }),
      el('input', { class: 'input', id: 'settingsName', value: App.me.displayName, maxlength: 40 })
    ),
    el('div', { class: 'field' },
      el('label', { class: 'field-label', text: 'Bio / status' }),
      el('textarea', { class: 'input textarea', id: 'settingsBio', rows: 3, maxlength: 120, placeholder: 'Seu status...' })
    ),
    el('button', { class: 'btn btn-primary btn-block', type: 'submit', text: 'Salvar alterações' })
  );

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const displayName = form.querySelector('#settingsName').value.trim() || App.me.username;
    const bio = form.querySelector('#settingsBio').value.trim();
    try {
      const { user } = await API.updateMe({ displayName, bio });
      App.me = user;
      refreshMeUI();
      toast('Perfil atualizado');
      closeModal(overlay);
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  box.append(
    coverWrap,
    el('div', { class: 'profile-hero' }, avatarWrap, hiddenFile, avatarBtn,
      el('h3', { class: 'profile-name', text: App.me.displayName }),
      el('div', { class: 'profile-uname', text: '@' + App.me.username })
    ),
    form,
    buildThemePicker(),
    buildSoundToggle(),
    el('div', { class: 'modal-footer settings-logout' },
      el('button', { class: 'btn btn-danger btn-block', text: 'Sair da conta', onclick: () => { closeModal(overlay); logout(); } })
    )
  );
}

// ---------- temas ----------
const THEMES = [
  { key: 'blue', label: 'Azul (padrão)', swatch: ['#0a101d', '#2f6bff', '#4d86ff'] },
  { key: 'mono', label: 'Preto e branco', swatch: ['#050505', '#ffffff', '#8a8a8a'] },
  { key: 'redblack', label: 'Vermelho e preto', swatch: ['#0a0505', '#ff3b3b', '#241212'] },
  { key: 'green', label: 'Verde escuro e branco', swatch: ['#06120d', '#16a34a', '#f2fbf7'] },
];

function applyTheme(key) {
  const theme = THEMES.some((t) => t.key === key) ? key : 'blue';
  if (theme === 'blue') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('pulse_theme', theme);
}

function loadTheme() {
  const saved = localStorage.getItem('pulse_theme') || 'blue';
  applyTheme(saved);
}

function buildThemePicker() {
  const current = localStorage.getItem('pulse_theme') || 'blue';
  const grid = el('div', { class: 'theme-grid' });
  for (const t of THEMES) {
    const swatch = el('span', { class: 'theme-swatch' },
      ...t.swatch.map((c) => el('span', { class: 'theme-swatch-dot', style: `background:${c}` }))
    );
    const btn = el('button', {
      class: 'theme-option' + (t.key === current ? ' active' : ''),
      type: 'button',
      onclick: () => {
        applyTheme(t.key);
        grid.querySelectorAll('.theme-option').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
      },
    }, swatch, el('span', { class: 'theme-option-label', text: t.label }));
    grid.append(btn);
  }
  return el('div', { class: 'settings-section' },
    el('label', { class: 'field-label', text: 'Cores do app' }),
    grid
  );
}

// ---------- efeitos sonoros ----------
let audioCtx = null;
function getAudioCtx() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  if (!audioCtx) audioCtx = new Ctx();
  if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
  return audioCtx;
}
function soundsEnabled() {
  return localStorage.getItem('pulse_sounds') !== 'off';
}
function playTone(freq, duration, type, gainPeak, delay) {
  if (!soundsEnabled()) return;
  try {
    const ctx = getAudioCtx();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type || 'sine';
    osc.frequency.value = freq;
    const start = ctx.currentTime + (delay || 0);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.linearRampToValueAtTime(gainPeak || 0.12, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(start);
    osc.stop(start + duration + 0.03);
  } catch (e) {
    /* dispositivo sem suporte a áudio — ignora silenciosamente */
  }
}
function playSentSound() {
  playTone(720, 0.07, 'sine', 0.1, 0);
}
function playReceivedSound() {
  playTone(560, 0.08, 'sine', 0.12, 0);
  playTone(840, 0.1, 'sine', 0.1, 0.07);
}

function buildSoundToggle() {
  const on = soundsEnabled();
  const row = el('div', { class: 'settings-section' },
    el('label', { class: 'field-label', text: 'Sons' }),
    el('button', {
      class: 'sound-toggle' + (on ? ' active' : ''),
      type: 'button',
      onclick: function () {
        const nowOn = localStorage.getItem('pulse_sounds') !== 'off';
        localStorage.setItem('pulse_sounds', nowOn ? 'off' : 'on');
        this.classList.toggle('active');
        this.querySelector('.sound-toggle-label').textContent = nowOn ? 'Sons desativados' : 'Sons ativados';
        if (!nowOn) playSentSound();
      },
    },
      el('span', { class: 'sound-toggle-knob' }),
      el('span', { class: 'sound-toggle-label', text: on ? 'Sons ativados' : 'Sons desativados' })
    )
  );
  return row;
}

// ---------- papel de parede da conversa ----------
const WALLPAPER_PRESETS = [
  { key: 'default', label: 'Padrão do tema', css: '' },
  { key: 'midnight', label: 'Meia-noite', css: 'linear-gradient(160deg, #0b1224, #1b2440)' },
  { key: 'sunset', label: 'Pôr do sol', css: 'linear-gradient(160deg, #3a1c3d, #7a3b45, #c9743f)' },
  { key: 'forest', label: 'Floresta', css: 'linear-gradient(160deg, #0c2318, #164a32)' },
  { key: 'ocean', label: 'Oceano', css: 'linear-gradient(160deg, #041c33, #0c5c7a)' },
  { key: 'dots', label: 'Pontilhado', css: 'radial-gradient(circle, rgba(255,255,255,0.08) 1.5px, transparent 1.5px), var(--bg)', size: '18px 18px' },
];

function wallpaperKey(convId) {
  return `pulse_wallpaper:${convId}`;
}

function applyWallpaper(convId) {
  const container = document.getElementById('messages');
  if (!container) return;
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(wallpaperKey(convId)) || 'null'); } catch (e) { saved = null; }

  container.style.backgroundImage = '';
  container.style.backgroundSize = '';
  container.style.backgroundPosition = '';
  container.style.backgroundColor = '';

  if (!saved) return;
  if (saved.type === 'custom' && saved.dataUrl) {
    container.style.backgroundImage = `url('${saved.dataUrl}')`;
    container.style.backgroundSize = 'cover';
    container.style.backgroundPosition = 'center';
  } else if (saved.type === 'preset') {
    const preset = WALLPAPER_PRESETS.find((p) => p.key === saved.key);
    if (preset && preset.css) {
      container.style.backgroundImage = preset.css;
      if (preset.size) container.style.backgroundSize = preset.size;
    }
  }
}

function resizeImageFile(file, maxDim, quality) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Não consegui ler a imagem'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Imagem inválida'));
      img.onload = () => {
        let { width, height } = img;
        if (width > height && width > maxDim) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        } else if (height > maxDim) {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality || 0.72));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function openWallpaperPicker(convId) {
  const { overlay, box } = modal(
    el('div', { class: 'modal-head' },
      el('h3', { class: 'modal-title', text: 'Papel de parede' }),
      el('button', { class: 'icon-btn', onclick: () => closeModal(overlay), html: ICONS.close })
    )
  );

  const grid = el('div', { class: 'wallpaper-grid' });
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(wallpaperKey(convId)) || 'null'); } catch (e) { saved = null; }
  const currentKey = saved && saved.type === 'preset' ? saved.key : (saved ? null : 'default');

  for (const p of WALLPAPER_PRESETS) {
    const swatch = el('button', {
      class: 'wallpaper-swatch' + (p.key === currentKey ? ' active' : ''),
      type: 'button',
      style: p.css ? `background-image:${p.css};background-size:${p.size || 'cover'}` : 'background:var(--bg)',
      title: p.label,
      onclick: () => {
        if (p.key === 'default') localStorage.removeItem(wallpaperKey(convId));
        else localStorage.setItem(wallpaperKey(convId), JSON.stringify({ type: 'preset', key: p.key }));
        applyWallpaper(convId);
        closeModal(overlay);
        toast('Papel de parede atualizado');
      },
    }, el('span', { class: 'wallpaper-swatch-label', text: p.label }));
    grid.append(swatch);
  }

  const galleryBtn = el('button', { class: 'btn btn-block', type: 'button', text: '🖼️ Escolher foto da galeria' });
  const galleryFile = el('input', { type: 'file', accept: 'image/*', hidden: true });
  galleryBtn.addEventListener('click', () => galleryFile.click());
  galleryFile.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file || !file.type.startsWith('image/')) return;
    try {
      toast('Ajustando imagem...');
      const dataUrl = await resizeImageFile(file, 1280, 0.72);
      localStorage.setItem(wallpaperKey(convId), JSON.stringify({ type: 'custom', dataUrl }));
      applyWallpaper(convId);
      closeModal(overlay);
      toast('Papel de parede atualizado');
    } catch (err) {
      toast(err.message || 'Não consegui usar essa imagem', 'error');
    }
  });

  box.append(
    el('div', { class: 'modal-body' }, grid, galleryFile, galleryBtn),
    el('div', { class: 'modal-footer' },
      el('button', {
        class: 'btn btn-block', text: 'Remover papel de parede',
        onclick: () => {
          localStorage.removeItem(wallpaperKey(convId));
          applyWallpaper(convId);
          closeModal(overlay);
        },
      })
    )
  );
}

// ---------- logout ----------
async function logout() {
  teardownPush();
  try {
    await API.logout();
  } catch (_e) {
    /* ignore */
  }
  Storage.setToken(null);
  Socket.disconnect();
  App.me = null;
  App.token = null;
  App.conversations = [];
  App.messages = {};
  App.activeConvId = null;
  document.body.classList.remove('view-chat');
  showAuth('login');
}

// ---------- sender colors ----------
const SENDER_COLORS = ['#60a5fa', '#34d399', '#f472b6', '#fbbf24', '#a78bfa', '#22d3ee', '#fb7185', '#f97316', '#a3e635', '#facc15'];
function senderColor(id) {
  let h = 0;
  for (const c of String(id)) h = (h * 31 + Number(c)) >>> 0;
  return SENDER_COLORS[h % SENDER_COLORS.length];
}

// ---------- start ----------
loadTheme();
init();
