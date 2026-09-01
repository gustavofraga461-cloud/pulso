'use strict';

const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const http = require('node:http');
const express = require('express');
const multer = require('multer');
const { Server } = require('socket.io');

const db = require('./db');
const push = require('./push');
const ai = require('./ai');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
// Usa o mesmo DATA_DIR do banco de dados (disco persistente no Render),
// senão os arquivos enviados (fotos, áudios) somem a cada reinício do servidor.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const app = express();
app.set('trust proxy', true); // Render fica atrás de um proxy; sem isso, req.ip vem errado
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  maxHttpBufferSize: 2e7,
});

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// ---------- Static ----------
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '7d' }));
app.use(express.static(PUBLIC_DIR));

// ---------- Uploads ----------
const ALLOWED_MIMES = /^(image\/(jpeg|png|gif|webp)|audio\/(webm|ogg|mp3|m4a|mp4|wav|x-m4a|x-wav))$/;
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).slice(0, 10).toLowerCase() || '.bin';
    cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIMES.test(file.mimetype)) cb(null, true);
    else cb(new Error('tipo_de_arquivo_nao_suportado'));
  },
});

// ---------- Auth middleware ----------
function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'nao_autenticado' });
  const user = db.getUserByToken(token);
  if (!user) return res.status(401).json({ error: 'sessao_invalida' });
  req.user = user;
  req.token = token;
  next();
}

function sanitizeUsername(u) {
  return /^[a-zA-Z0-9_]{3,20}$/.test(u);
}

// ---------- REST: auth ----------
app.post('/api/auth/signup', (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  const displayName = String(req.body.displayName || '').trim() || username;

  if (!sanitizeUsername(username)) {
    return res.status(400).json({ error: 'nome_invalido', message: 'O nome de usuário deve ter de 3 a 20 caracteres (letras, números ou _).' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'senha_curta', message: 'A senha deve ter pelo menos 6 caracteres.' });
  }
  if (db.getUserByUsername(username)) {
    return res.status(409).json({ error: 'usuario_existe', message: 'Este nome de usuário já está em uso.' });
  }
  const user = db.createUser({ username, password, displayName, bio: '' });
  const token = db.createSession(user.id);
  res.status(201).json({ token, user });
});

// ---------- limite de tentativas de login (evita força bruta de senha) ----------
const loginAttempts = new Map(); // chave: ip+username -> { count, blockedUntil }
const LOGIN_MAX_ATTEMPTS = 6;
const LOGIN_WINDOW_MS = 10 * 60 * 1000; // 10 minutos

function loginAttemptKey(req, username) {
  return `${req.ip}:${username.toLowerCase()}`;
}

app.post('/api/auth/login', (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  const key = loginAttemptKey(req, username);
  const entry = loginAttempts.get(key);

  if (entry && entry.blockedUntil && entry.blockedUntil > Date.now()) {
    const waitMin = Math.ceil((entry.blockedUntil - Date.now()) / 60000);
    return res.status(429).json({
      error: 'muitas_tentativas',
      message: `Muitas tentativas de login. Tente novamente em ${waitMin} minuto(s).`,
    });
  }

  const result = db.verifyPassword(username, password);
  if (!result.ok) {
    const fresh = entry && entry.windowStart > Date.now() - LOGIN_WINDOW_MS ? entry : { count: 0, windowStart: Date.now() };
    fresh.count += 1;
    if (fresh.count >= LOGIN_MAX_ATTEMPTS) {
      fresh.blockedUntil = Date.now() + LOGIN_WINDOW_MS;
    }
    loginAttempts.set(key, fresh);

    if (result.reason === 'not_found') {
      return res.status(401).json({ error: 'usuario_nao_encontrado', message: 'Usuário não encontrado. Verifique o nome de usuário ou crie uma conta.' });
    }
    return res.status(401).json({ error: 'senha_incorreta', message: 'Senha incorreta. Tente novamente.' });
  }

  loginAttempts.delete(key);
  const token = db.createSession(result.user.id);
  res.json({ token, user: result.user });
});

app.post('/api/auth/logout', authRequired, (req, res) => {
  db.deleteSession(req.token);
  res.json({ ok: true });
});

app.get('/api/auth/me', authRequired, (req, res) => {
  res.json({ user: req.user });
});

// ---------- REST: users ----------
app.get('/api/users', authRequired, (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.json([]);
  res.json(db.searchUsers(q, req.user.id));
});

app.get('/api/users/:id', authRequired, (req, res) => {
  const user = db.getUserById(req.params.id);
  if (!user) return res.status(404).json({ error: 'usuario_nao_encontrado' });
  res.json({ user });
});

app.put('/api/users/me', authRequired, (req, res) => {
  const fields = {};
  if (req.body.displayName !== undefined) fields.displayName = String(req.body.displayName).trim().slice(0, 40) || req.user.username;
  if (req.body.bio !== undefined) fields.bio = String(req.body.bio).trim().slice(0, 120);
  if (req.body.avatar !== undefined) fields.avatar = String(req.body.avatar);
  if (req.body.cover !== undefined) fields.cover = String(req.body.cover);
  const user = db.updateUser(req.user.id, fields);
  res.json({ user });
});

app.delete('/api/users/me', authRequired, (req, res) => {
  const userId = req.user.id;
  db.deleteSession(req.token);
  db.deleteAccount(userId);
  io.emit('user:deleted', { userId });
  res.json({ ok: true });
});

app.post('/api/users/:id/block', authRequired, (req, res) => {
  const targetId = Number(req.params.id);
  if (!targetId || targetId === req.user.id) return res.status(400).json({ error: 'alvo_invalido' });
  const target = db.getUserById(targetId);
  if (!target) return res.status(404).json({ error: 'usuario_nao_encontrado' });
  db.blockUser(req.user.id, targetId);
  res.json({ ok: true });
});

app.post('/api/users/:id/unblock', authRequired, (req, res) => {
  const targetId = Number(req.params.id);
  db.unblockUser(req.user.id, targetId);
  res.json({ ok: true });
});

app.get('/api/users/:id/blocked', authRequired, (req, res) => {
  const targetId = Number(req.params.id);
  res.json({ blockedByMe: db.isBlocked(req.user.id, targetId), blockedMe: db.isBlocked(targetId, req.user.id) });
});

app.post('/api/users/:id/report', authRequired, (req, res) => {
  const targetId = Number(req.params.id);
  if (!targetId || targetId === req.user.id) return res.status(400).json({ error: 'alvo_invalido' });
  const target = db.getUserById(targetId);
  if (!target) return res.status(404).json({ error: 'usuario_nao_encontrado' });
  const reason = String(req.body.reason || '').trim().slice(0, 500);
  db.addReport(req.user.id, targetId, reason);
  res.json({ ok: true });
});

// ---------- REST: conversations ----------
app.get('/api/conversations', authRequired, (req, res) => {
  db.ensureBotConversation(req.user.id);
  res.json({ conversations: db.getConversationList(req.user.id) });
});

app.get('/api/conversations/:id', authRequired, (req, res) => {
  const conv = db.getConversation(req.params.id);
  if (!conv || !db.isMember(conv.id, req.user.id)) {
    return res.status(404).json({ error: 'conversa_nao_encontrada' });
  }
  res.json({ conversation: conv });
});

app.post('/api/conversations', authRequired, (req, res) => {
  const { type } = req.body;
  if (type === 'private') {
    const otherId = Number(req.body.userId);
    if (!otherId || otherId === req.user.id) return res.status(400).json({ error: 'destinatario_invalido' });
    const other = db.getUserById(otherId);
    if (!other) return res.status(404).json({ error: 'usuario_nao_encontrado' });
    let convId = db.findPrivateConversation(req.user.id, otherId);
    if (!convId) {
      convId = db.createConversation({ type: 'private', createdBy: req.user.id });
      db.addMember(convId, req.user.id, 1);
      db.addMember(convId, otherId, 1);
    }
    syncUserRooms(req.user.id);
    syncUserRooms(otherId);
    return res.json({ conversation: db.getConversation(convId) });
  }

  if (type === 'group') {
    const name = String(req.body.name || '').trim().slice(0, 40);
    const memberIds = Array.isArray(req.body.memberIds)
      ? [...new Set(req.body.memberIds.map(Number).filter((n) => Number.isInteger(n) && n !== req.user.id))]
      : [];
    if (!name) return res.status(400).json({ error: 'nome_obrigatorio', message: 'Dê um nome ao grupo.' });
    if (!memberIds.length) return res.status(400).json({ error: 'sem_membros', message: 'Adicione pelo menos um participante.' });

    const validMembers = memberIds
      .map((id) => db.getUserById(id))
      .filter(Boolean)
      .map((u) => u.id);
    if (!validMembers.length) return res.status(400).json({ error: 'sem_membros' });

    const avatar = String(req.body.avatar || '');
    const convId = db.createConversation({ type: 'group', name, avatar, createdBy: req.user.id });
    db.addMember(convId, req.user.id, 1);
    validMembers.forEach((id) => db.addMember(convId, id, 0));
    db.addMessage(convId, req.user.id, 'system', `${req.user.displayName} criou o grupo`);
    const conversation = db.getConversation(convId);
    [req.user.id, ...validMembers].forEach((id) => syncUserRooms(id));
    io.emit('conversation:new', { conversationId: convId, forUserIds: [req.user.id, ...validMembers] });
    return res.status(201).json({ conversation });
  }

  res.status(400).json({ error: 'tipo_invalido' });
});

app.put('/api/conversations/:id/avatar', authRequired, (req, res) => {
  const conv = db.getConversation(req.params.id);
  if (!conv || !db.isMember(conv.id, req.user.id)) return res.status(404).json({ error: 'conversa_nao_encontrada' });
  if (conv.type !== 'group') return res.status(400).json({ error: 'operacao_invalida' });
  const member = conv.members.find((m) => m.userId === req.user.id);
  if (!member || !member.isAdmin) return res.status(403).json({ error: 'sem_permissao' });
  const avatar = String(req.body.avatar || '');
  db.updateConversation(conv.id, { avatar });
  db.addMessage(conv.id, req.user.id, 'system', `${req.user.displayName} alterou a foto do grupo`);
  emitConversationUpdate(conv.id);
  const changed = db.getLastMessage(conv.id);
  if (changed) io.to(`conv:${conv.id}`).emit('message:new', changed);
  res.json({ conversation: db.getConversation(conv.id) });
});

app.post('/api/conversations/:id/members', authRequired, (req, res) => {
  const conv = db.getConversation(req.params.id);
  if (!conv || !db.isMember(conv.id, req.user.id)) return res.status(404).json({ error: 'conversa_nao_encontrada' });
  const member = conv.members.find((m) => m.userId === req.user.id);
  if (!member || !member.isAdmin) return res.status(403).json({ error: 'sem_permissao' });
  const newUserId = Number(req.body.userId);
  const newUser = db.getUserById(newUserId);
  if (!newUser || newUserId === req.user.id || db.isMember(conv.id, newUserId)) {
    return res.status(400).json({ error: 'membro_invalido' });
  }
  db.addMember(conv.id, newUserId, 0);
  db.addMessage(conv.id, req.user.id, 'system', `${req.user.displayName} adicionou ${newUser.displayName}`);
  syncUserRooms(newUserId);
  emitConversationUpdate(conv.id);
  io.emit('conversation:new', { conversationId: conv.id, forUserIds: [newUserId] });
  const created = db.getLastMessage(conv.id);
  if (created) {
    io.to(`conv:${conv.id}`).emit('message:new', created);
  }
  res.json({ conversation: db.getConversation(conv.id) });
});

app.post('/api/conversations/:id/leave', authRequired, (req, res) => {
  const conv = db.getConversation(req.params.id);
  if (!conv) return res.status(404).json({ error: 'conversa_nao_encontrada' });
  if (conv.type !== 'group') return res.status(400).json({ error: 'operacao_invalida' });
  if (!db.isMember(conv.id, req.user.id)) return res.status(404).json({ error: 'conversa_nao_encontrada' });
  db.addMessage(conv.id, req.user.id, 'system', `${req.user.displayName} saiu do grupo`);
  db.removeMember(conv.id, req.user.id);
  syncUserRooms(req.user.id);
  emitConversationUpdate(conv.id);
  const left = db.getLastMessage(conv.id);
  if (left) io.to(`conv:${conv.id}`).emit('message:new', left);
  res.json({ ok: true });
});

app.delete('/api/conversations/:id', authRequired, (req, res) => {
  const conv = db.getConversation(req.params.id);
  if (!conv || !db.isMember(conv.id, req.user.id)) {
    return res.status(404).json({ error: 'conversa_nao_encontrada' });
  }
  const memberIds = conv.members.map((m) => m.userId);
  db.deleteConversation(conv.id);
  // Avisa quem estiver online que a conversa sumiu, pra tela dele atualizar sozinha.
  io.to(`conv:${conv.id}`).emit('conversation:deleted', { conversationId: conv.id });
  for (const uid of memberIds) syncUserRooms(uid);
  res.json({ ok: true });
});

app.get('/api/conversations/:id/messages', authRequired, (req, res) => {
  const conv = db.getConversation(req.params.id);
  if (!conv || !db.isMember(conv.id, req.user.id)) return res.status(404).json({ error: 'conversa_nao_encontrada' });
  const beforeId = req.query.beforeId ? Number(req.query.beforeId) : null;
  const limit = Math.min(Number(req.query.limit) || 50, 100);
  res.json({ messages: db.getMessages(conv.id, { beforeId, limit }) });
});

app.post('/api/conversations/:id/messages', authRequired, (req, res) => {
  const conv = db.getConversation(req.params.id);
  if (!conv || !db.isMember(conv.id, req.user.id)) return res.status(404).json({ error: 'conversa_nao_encontrada' });

  if (conv.type === 'private') {
    const peerMember = conv.members.find((m) => m.userId !== req.user.id);
    if (peerMember && db.isBlockedEitherWay(req.user.id, peerMember.userId)) {
      return res.status(403).json({ error: 'bloqueado', message: 'Não é possível enviar mensagens nessa conversa.' });
    }
  }

  const type = req.body.type === 'image' || req.body.type === 'audio' ? req.body.type : 'text';
  const content = String(req.body.content || '').trim().slice(0, 5000);
  if (!content) return res.status(400).json({ error: 'conteudo_vazio' });
  let replyToId = req.body.replyToId ? Number(req.body.replyToId) : null;
  if (replyToId) {
    const original = db.getMessage(replyToId);
    if (!original || Number(original.conversation_id) !== conv.id) replyToId = null;
  }

  const messageId = db.addMessage(conv.id, req.user.id, type, content, replyToId);
  markDeliveredForOnline(conv, messageId);
  const payload = db.getLastMessage(conv.id);
  if (payload) io.to(`conv:${conv.id}`).emit('message:new', payload);
  pushMessageToRecipients(conv, payload, req.user.id);
  res.status(201).json({ message: payload });

  maybeReplyAsBot(conv, req.user.id);
});

// ---------- bot FragaIA: gera e envia a resposta da IA ----------
function maybeReplyAsBot(conversation, fromUserId) {
  const bot = db.getBotUser();
  if (!bot || conversation.type !== 'private') return;
  const isBotConversation = conversation.members.some((m) => m.userId === bot.id);
  if (!isBotConversation || Number(fromUserId) === bot.id) return;

  // Roda em segundo plano: quem mandou a mensagem já recebeu a resposta HTTP normal,
  // a resposta do bot chega depois via socket, como uma mensagem nova de verdade.
  (async () => {
    try {
      const recent = db.getMessages(conversation.id, { limit: 20 });
      const history = recent
        .filter((m) => m.type === 'text' && !m.deleted)
        .map((m) => ({ role: m.senderId === bot.id ? 'model' : 'user', text: m.content }));

      const replyText = await ai.generateReply(history);
      const replyId = db.addMessage(conversation.id, bot.id, 'text', replyText);
      const replyPayload = db.getLastMessage(conversation.id);
      if (replyPayload) {
        io.to(`conv:${conversation.id}`).emit('message:new', replyPayload);
        const freshConv = db.getConversation(conversation.id);
        pushMessageToRecipients(freshConv, replyPayload, bot.id);
      }
    } catch (err) {
      console.error('Erro ao gerar resposta do FragaIA:', err);
    }
  })();
}

app.delete('/api/conversations/:id/messages/:messageId', authRequired, (req, res) => {
  const conv = db.getConversation(req.params.id);
  if (!conv || !db.isMember(conv.id, req.user.id)) return res.status(404).json({ error: 'conversa_nao_encontrada' });
  const message = db.getMessage(req.params.messageId);
  if (!message || Number(message.conversation_id) !== conv.id) {
    return res.status(404).json({ error: 'mensagem_nao_encontrada' });
  }
  if (message.type === 'system') return res.status(400).json({ error: 'operacao_invalida' });
  const member = conv.members.find((m) => m.userId === req.user.id);
  const isSender = message.sender_id && Number(message.sender_id) === req.user.id;
  const isGroupAdmin = conv.type === 'group' && member && member.isAdmin;
  if (!isSender && !isGroupAdmin) return res.status(403).json({ error: 'sem_permissao' });

  db.deleteMessageForEveryone(message.id);
  const payload = db.buildMessagePayload(db.getMessage(message.id), db.getConversation(conv.id));
  io.to(`conv:${conv.id}`).emit('message:deleted', payload);
  emitConversationUpdate(conv.id);
  res.json({ message: payload });
});

app.put('/api/conversations/:id/messages/:messageId', authRequired, (req, res) => {
  const conv = db.getConversation(req.params.id);
  if (!conv || !db.isMember(conv.id, req.user.id)) return res.status(404).json({ error: 'conversa_nao_encontrada' });
  const message = db.getMessage(req.params.messageId);
  if (!message || Number(message.conversation_id) !== conv.id) {
    return res.status(404).json({ error: 'mensagem_nao_encontrada' });
  }
  if (!message.sender_id || Number(message.sender_id) !== req.user.id) {
    return res.status(403).json({ error: 'sem_permissao' });
  }
  if (message.type !== 'text' || message.deleted) {
    return res.status(400).json({ error: 'operacao_invalida' });
  }
  const content = String(req.body.content || '').trim().slice(0, 5000);
  if (!content) return res.status(400).json({ error: 'conteudo_vazio' });

  db.editMessage(message.id, content);
  const payload = db.buildMessagePayload(db.getMessage(message.id), conv);
  io.to(`conv:${conv.id}`).emit('message:edited', payload);
  emitConversationUpdate(conv.id);
  res.json({ message: payload });
});

app.put('/api/conversations/:id/messages/:messageId/reaction', authRequired, (req, res) => {
  const conv = db.getConversation(req.params.id);
  if (!conv || !db.isMember(conv.id, req.user.id)) return res.status(404).json({ error: 'conversa_nao_encontrada' });
  const message = db.getMessage(req.params.messageId);
  if (!message || Number(message.conversation_id) !== conv.id) {
    return res.status(404).json({ error: 'mensagem_nao_encontrada' });
  }
  const emoji = String(req.body.emoji || '').trim().slice(0, 8);
  if (emoji) {
    db.setReaction(message.id, req.user.id, emoji);
  } else {
    db.removeReaction(message.id, req.user.id);
  }
  const payload = db.buildMessagePayload(db.getMessage(message.id), conv);
  io.to(`conv:${conv.id}`).emit('message:reaction', payload);
  res.json({ message: payload });
});

app.put('/api/conversations/:id/pin', authRequired, (req, res) => {
  const conv = db.getConversation(req.params.id);
  if (!conv || !db.isMember(conv.id, req.user.id)) return res.status(404).json({ error: 'conversa_nao_encontrada' });
  db.setPinned(conv.id, req.user.id, !!req.body.pinned);
  res.json({ ok: true });
});

app.put('/api/conversations/:id/mute', authRequired, (req, res) => {
  const conv = db.getConversation(req.params.id);
  if (!conv || !db.isMember(conv.id, req.user.id)) return res.status(404).json({ error: 'conversa_nao_encontrada' });
  db.setMuted(conv.id, req.user.id, !!req.body.muted);
  res.json({ ok: true });
});

app.post('/api/conversations/:id/read', authRequired, (req, res) => {
  const conv = db.getConversation(req.params.id);
  if (!conv || !db.isMember(conv.id, req.user.id)) return res.status(404).json({ error: 'conversa_nao_encontrada' });
  const messageId = Number(req.body.messageId) || 0;
  const lastReadId = db.markRead(req.user.id, conv.id, messageId);
  io.to(`conv:${conv.id}`).emit('read', {
    conversationId: conv.id,
    userId: req.user.id,
    lastReadMessageId: lastReadId,
  });
  res.json({ ok: true, lastReadMessageId: lastReadId });
});

app.post('/api/upload', authRequired, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'arquivo_obrigatorio' });
  res.json({ url: `/uploads/${req.file.filename}` });
});

// ---------- Push (Web Push / PWA) ----------
app.get('/api/push/vapid-public-key', (_req, res) => {
  res.json({ publicKey: push.getPublicKey() });
});

app.post('/api/push/subscribe', authRequired, (req, res) => {
  const sub = push.normalizeSubscription(req.body.subscription);
  if (!sub) return res.status(400).json({ error: 'assinatura_invalida' });
  db.upsertPushSubscription(req.user.id, sub);
  res.json({ ok: true });
});

app.post('/api/push/unsubscribe', authRequired, (req, res) => {
  const endpoint = String(req.body.endpoint || '');
  if (endpoint) db.deletePushSubscription(endpoint);
  else db.deletePushSubscriptionsByUser(req.user.id);
  res.json({ ok: true });
});

function pushMessageToRecipients(conversation, payload, excludeUserId) {
  const text = payload.type === 'image' ? 'Foto' : payload.type === 'audio' ? 'Áudio' : payload.content;
  const sender = payload.sender || {};
  for (const member of conversation.members) {
    if (member.userId === Number(excludeUserId)) continue;
    if (presence.has(member.userId)) continue;
    if (member.muted) continue;
    const subs = db.getPushSubscriptionsByUser(member.userId);
    for (const sub of subs) {
      push.sendPush(sub, {
        title: sender.displayName || 'Pulse',
        body: text,
        conversationId: conversation.id,
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
        senderId: Number(excludeUserId),
      });
    }
  }
}

// ---------- Presence ----------
const presence = new Map(); // userId -> Set<socketId>

function syncUserRooms(userId) {
  const sockets = io.of('/').sockets;
  const ids = db.getConversationIdsForUser(userId).map((id) => `conv:${id}`);
  for (const socket of sockets.values()) {
    if (socket.userId === Number(userId)) {
      socket.join(ids);
    }
  }
}

function markDeliveredForOnline(conversation, messageId) {
  const recipients = conversation.members.filter((m) => m.userId !== conversation.senderId);
  const anyOnline = recipients.some((m) => presence.has(m.userId));
  if (anyOnline) db.markDelivered(conversation.id, messageId);
}

function emitConversationUpdate(conversationId) {
  const conv = db.getConversation(conversationId);
  if (!conv) return;
  for (const member of conv.members) {
    const summary = db.buildConversationSummary(member.userId, conv);
    for (const socket of io.of('/').sockets.values()) {
      if (socket.userId === member.userId) {
        socket.emit('conversation:update', summary);
      }
    }
  }
}

// ---------- Socket.IO ----------
io.use((socket, next) => {
  const token = socket.handshake.auth && socket.handshake.auth.token;
  if (!token) return next(new Error('nao_autenticado'));
  const user = db.getUserByToken(token);
  if (!user) return next(new Error('sessao_invalida'));
  socket.userId = user.id;
  next();
});

io.on('connection', (socket) => {
  const userId = socket.userId;

  if (!presence.has(userId)) presence.set(userId, new Set());
  presence.get(userId).add(socket.id);

  socket.join(`user:${userId}`);
  syncUserRooms(userId);

  db.setUserPresence(userId, true);
  io.emit('presence', { userId, online: true });

  socket.on('typing', (data) => {
    const conversationId = Number(data.conversationId);
    if (!conversationId || !db.isMember(conversationId, userId)) return;
    socket.to(`conv:${conversationId}`).emit('typing', {
      conversationId,
      userId,
      isTyping: !!data.isTyping,
    });
  });

  socket.on('read', (data) => {
    const conversationId = Number(data.conversationId);
    const messageId = Number(data.messageId) || 0;
    if (!conversationId || !db.isMember(conversationId, userId)) return;
    const lastReadId = db.markRead(userId, conversationId, messageId);
    io.to(`conv:${conversationId}`).emit('read', {
      conversationId,
      userId,
      lastReadMessageId: lastReadId,
    });
  });

  socket.on('disconnect', () => {
    const set = presence.get(userId);
    if (set) {
      set.delete(socket.id);
      if (set.size === 0) {
        presence.delete(userId);
        db.setUserPresence(userId, false);
        io.emit('presence', { userId, online: false, lastSeen: db.now() });
      }
    }
  });
});

// ---------- SPA fallback ----------
app.get('*', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

server.listen(PORT, () => {
  db.ensureBotUser();
  if (!ai.isConfigured()) {
    console.warn('Aviso: GEMINI_API_KEY não configurada — o FragaIA vai responder com um aviso até você configurar essa variável de ambiente.');
  }
  console.log(`Pulse server rodando em http://localhost:${PORT}`);
});
