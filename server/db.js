'use strict';

const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'pulse.db'));

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    display_name TEXT NOT NULL,
    bio TEXT NOT NULL DEFAULT '',
    avatar TEXT NOT NULL DEFAULT '',
    online INTEGER NOT NULL DEFAULT 0,
    last_seen INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    name TEXT,
    avatar TEXT NOT NULL DEFAULT '',
    created_by INTEGER,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS conversation_members (
    conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    last_read_message_id INTEGER NOT NULL DEFAULT 0,
    is_admin INTEGER NOT NULL DEFAULT 0,
    joined_at INTEGER NOT NULL,
    PRIMARY KEY (conversation_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    sender_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    type TEXT NOT NULL DEFAULT 'text',
    content TEXT NOT NULL DEFAULT '',
    delivered INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, id);

  CREATE TABLE IF NOT EXISTS push_subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    endpoint TEXT UNIQUE NOT NULL,
    keys_p256dh TEXT NOT NULL,
    keys_auth TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_push_user ON push_subscriptions(user_id);
`);

// Migração leve: adiciona colunas novas em bancos já existentes (ex: no Render)
// sem precisar apagar o banco. PRAGMA table_info diz quais colunas já existem.
function ensureColumn(table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}
ensureColumn('messages', 'deleted', "INTEGER NOT NULL DEFAULT 0");
ensureColumn('users', 'is_bot', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('users', 'cover', "TEXT NOT NULL DEFAULT ''");

function now() {
  return Date.now();
}

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function sanitizeUser(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    username: row.username,
    displayName: row.display_name,
    bio: row.bio || '',
    avatar: row.avatar || '',
    cover: row.cover || '',
    online: !!row.online,
    lastSeen: Number(row.last_seen || 0),
    isBot: !!row.is_bot,
    createdAt: Number(row.created_at),
  };
}

function getUserById(id) {
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(id));
  return sanitizeUser(row);
}

function getUserByUsername(username) {
  const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  return sanitizeUser(row);
}

function createUser({ username, password, displayName, bio = '', avatar = '' }) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = hashPassword(password, salt);
  const info = db
    .prepare(
      'INSERT INTO users (username, password_hash, salt, display_name, bio, avatar, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    )
    .run(username, hash, salt, displayName, bio, avatar, now());
  return getUserById(Number(info.lastInsertRowid));
}

function verifyPassword(username, password) {
  const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!row) return { ok: false, reason: 'not_found' };
  if (hashPassword(password, row.salt) !== row.password_hash) return { ok: false, reason: 'wrong_password' };
  return { ok: true, user: sanitizeUser(row) };
}

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)').run(token, Number(userId), now());
  return token;
}

function getUserByToken(token) {
  const row = db
    .prepare('SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?')
    .get(token);
  return sanitizeUser(row);
}

function deleteSession(token) {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

function searchUsers(query, excludeUserId, limit = 20) {
  const like = `%${query}%`;
  const rows = db
    .prepare(
      'SELECT * FROM users WHERE username LIKE ? AND id != ? AND is_bot = 0 ORDER BY username LIMIT ?'
    )
    .all(like, Number(excludeUserId), limit);
  return rows.map(sanitizeUser);
}

function updateUser(userId, fields) {
  const sets = [];
  const args = [];
  if (fields.displayName !== undefined) {
    sets.push('display_name = ?');
    args.push(fields.displayName);
  }
  if (fields.bio !== undefined) {
    sets.push('bio = ?');
    args.push(fields.bio);
  }
  if (fields.avatar !== undefined) {
    sets.push('avatar = ?');
    args.push(fields.avatar);
  }
  if (fields.cover !== undefined) {
    sets.push('cover = ?');
    args.push(fields.cover);
  }
  if (!sets.length) return getUserById(userId);
  args.push(Number(userId));
  db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...args);
  return getUserById(userId);
}

function setUserPresence(userId, online) {
  const row = db
    .prepare('UPDATE users SET online = ?, last_seen = CASE WHEN ? = 1 THEN last_seen ELSE ? END WHERE id = ?')
    .run(online ? 1 : 0, online ? 1 : 0, online ? 0 : now(), Number(userId));
  return row;
}

// ---------- bot FragaIA ----------
const BOT_USERNAME = 'fragaia';

function ensureBotUser() {
  let bot = getUserByUsername(BOT_USERNAME);
  if (bot) return bot;
  const salt = crypto.randomBytes(16).toString('hex');
  // Senha aleatória e descartada: o bot nunca faz login normal, então ninguém precisa dela.
  const randomPassword = crypto.randomBytes(24).toString('hex');
  const hash = hashPassword(randomPassword, salt);
  const info = db
    .prepare(
      'INSERT INTO users (username, password_hash, salt, display_name, bio, avatar, is_bot, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)'
    )
    .run(
      BOT_USERNAME,
      hash,
      salt,
      'FragaIA 🤖',
      'Sua assistente de IA aqui no Pulse ✨ Pode me chamar!',
      '/icons/fragaia-avatar.svg',
      now()
    );
  return getUserById(Number(info.lastInsertRowid));
}

function getBotUser() {
  return getUserByUsername(BOT_USERNAME);
}

// Garante que todo usuário tenha uma conversa fixa com o FragaIA, criando na
// primeira vez (e mandando uma mensagem de boas-vindas do bot).
function ensureBotConversation(userId) {
  const bot = ensureBotUser();
  if (Number(userId) === bot.id) return null;
  let convId = findPrivateConversation(userId, bot.id);
  if (!convId) {
    convId = createConversation({ type: 'private', createdBy: userId });
    addMember(convId, userId, 1);
    addMember(convId, bot.id, 1);
    addMessage(
      convId,
      bot.id,
      'text',
      'Oi! Eu sou o FragaIA 🤖 Pode me perguntar qualquer coisa por aqui, a qualquer hora.'
    );
  }
  return convId;
}

function findPrivateConversation(a, b) {
  const row = db
    .prepare(
      `SELECT c.id FROM conversations c
       WHERE c.type = 'private'
         AND (SELECT COUNT(*) FROM conversation_members WHERE conversation_id = c.id) = 2
         AND EXISTS (SELECT 1 FROM conversation_members cm WHERE cm.conversation_id = c.id AND cm.user_id = ?)
         AND EXISTS (SELECT 1 FROM conversation_members cm WHERE cm.conversation_id = c.id AND cm.user_id = ?)`
    )
    .get(Number(a), Number(b));
  return row ? Number(row.id) : null;
}

function createConversation({ type, name = null, avatar = '', createdBy }) {
  const info = db
    .prepare('INSERT INTO conversations (type, name, avatar, created_by, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(type, name, avatar, Number(createdBy), now());
  return Number(info.lastInsertRowid);
}

function addMember(conversationId, userId, isAdmin = 0) {
  db.prepare(
    'INSERT OR IGNORE INTO conversation_members (conversation_id, user_id, last_read_message_id, is_admin, joined_at) VALUES (?, ?, 0, ?, ?)'
  ).run(Number(conversationId), Number(userId), isAdmin ? 1 : 0, now());
}

function removeMember(conversationId, userId) {
  db.prepare('DELETE FROM conversation_members WHERE conversation_id = ? AND user_id = ?').run(
    Number(conversationId),
    Number(userId)
  );
}

function deleteConversation(conversationId) {
  // A tabela conversation_members e messages têm ON DELETE CASCADE,
  // então apagar a conversa já apaga os membros e mensagens junto.
  db.prepare('DELETE FROM conversations WHERE id = ?').run(Number(conversationId));
}

function getMemberIds(conversationId) {
  return db
    .prepare('SELECT user_id FROM conversation_members WHERE conversation_id = ?')
    .all(Number(conversationId))
    .map((r) => Number(r.user_id));
}

function isMember(conversationId, userId) {
  const row = db
    .prepare('SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?')
    .get(Number(conversationId), Number(userId));
  return !!row;
}

function getConversationIdsForUser(userId) {
  return db
    .prepare('SELECT conversation_id FROM conversation_members WHERE user_id = ?')
    .all(Number(userId))
    .map((r) => Number(r.conversation_id));
}

function getConversation(id) {
  const c = db.prepare('SELECT * FROM conversations WHERE id = ?').get(Number(id));
  if (!c) return null;
  const memberRows = db
    .prepare('SELECT * FROM conversation_members WHERE conversation_id = ?')
    .all(Number(id));
  const members = memberRows.map((r) => {
    const u = getUserById(r.user_id);
    return {
      userId: Number(r.user_id),
      username: u ? u.username : '',
      displayName: u ? u.displayName : 'Usuário removido',
      avatar: u ? u.avatar : '',
      cover: u ? u.cover : '',
      bio: u ? u.bio : '',
      online: u ? u.online : false,
      lastSeen: u ? u.lastSeen : 0,
      isBot: u ? u.isBot : false,
      lastReadMessageId: Number(r.last_read_message_id),
      isAdmin: !!r.is_admin,
      joinedAt: Number(r.joined_at),
    };
  });
  return {
    id: Number(c.id),
    type: c.type,
    name: c.name,
    avatar: c.avatar || '',
    createdBy: c.created_by ? Number(c.created_by) : null,
    createdAt: Number(c.created_at),
    members,
  };
}

function updateConversation(conversationId, fields) {
  const sets = [];
  const args = [];
  if (fields.name !== undefined) {
    sets.push('name = ?');
    args.push(fields.name);
  }
  if (fields.avatar !== undefined) {
    sets.push('avatar = ?');
    args.push(fields.avatar);
  }
  if (!sets.length) return getConversation(conversationId);
  args.push(Number(conversationId));
  db.prepare(`UPDATE conversations SET ${sets.join(', ')} WHERE id = ?`).run(...args);
  return getConversation(conversationId);
}

function addMessage(conversationId, senderId, type, content) {
  const info = db
    .prepare(
      'INSERT INTO messages (conversation_id, sender_id, type, content, delivered, created_at) VALUES (?, ?, ?, ?, 0, ?)'
    )
    .run(Number(conversationId), senderId ? Number(senderId) : null, type, content, now());
  return Number(info.lastInsertRowid);
}

function getMessage(id) {
  return db.prepare('SELECT * FROM messages WHERE id = ?').get(Number(id));
}

function deleteMessageForEveryone(messageId) {
  db.prepare("UPDATE messages SET deleted = 1, content = '' WHERE id = ?").run(Number(messageId));
}

function markDelivered(conversationId, upToId) {
  db.prepare('UPDATE messages SET delivered = 1 WHERE conversation_id = ? AND id <= ? AND delivered = 0').run(
    Number(conversationId),
    Number(upToId)
  );
}

function computeStatus(message, conversation) {
  if (!message || !message.sender_id) return 'sent';
  const others = conversation.members.filter((m) => m.userId !== Number(message.sender_id));
  if (conversation.type === 'private') {
    const other = others[0];
    if (!other) return 'sent';
    if (other.lastReadMessageId >= Number(message.id)) return 'read';
    if (message.delivered) return 'delivered';
    return 'sent';
  }
  const readCount = others.filter((m) => m.lastReadMessageId >= Number(message.id)).length;
  if (others.length && readCount >= others.length) return 'read';
  if (message.delivered) return 'delivered';
  return 'sent';
}

function buildMessagePayload(message, conversation) {
  const sender = message.sender_id ? getUserById(message.sender_id) : null;
  return {
    id: Number(message.id),
    conversationId: Number(message.conversation_id),
    senderId: message.sender_id ? Number(message.sender_id) : null,
    type: message.type,
    content: message.deleted ? '' : message.content,
    deleted: !!message.deleted,
    createdAt: Number(message.created_at),
    delivered: !!message.delivered,
    status: computeStatus(message, conversation),
    sender: sender
      ? { id: sender.id, username: sender.username, displayName: sender.displayName, avatar: sender.avatar }
      : null,
  };
}

function getLastMessage(conversationId) {
  const row = db
    .prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT 1')
    .get(Number(conversationId));
  if (!row) return null;
  const conv = getConversation(conversationId);
  return buildMessagePayload(row, conv);
}

function getMessages(conversationId, { beforeId = null, limit = 50 } = {}) {
  const rows = beforeId
    ? db
        .prepare(
          'SELECT * FROM messages WHERE conversation_id = ? AND id < ? ORDER BY id DESC LIMIT ?'
        )
        .all(Number(conversationId), Number(beforeId), limit)
    : db
        .prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT ?')
        .all(Number(conversationId), limit);
  rows.reverse();
  const conv = getConversation(conversationId);
  return rows.map((row) => buildMessagePayload(row, conv));
}

function countUnread(userId, conversationId) {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n FROM messages m
       JOIN conversation_members cm ON cm.conversation_id = m.conversation_id AND cm.user_id = ?
       WHERE m.conversation_id = ? AND m.id > cm.last_read_message_id AND m.sender_id != ?`
    )
    .get(Number(userId), Number(conversationId), Number(userId));
  return Number(row.n);
}

function markRead(userId, conversationId, messageId) {
  const current = db
    .prepare('SELECT last_read_message_id FROM conversation_members WHERE conversation_id = ? AND user_id = ?')
    .get(Number(conversationId), Number(userId));
  const target = Math.max(current ? Number(current.last_read_message_id) : 0, Number(messageId || 0));
  db.prepare(
    'UPDATE conversation_members SET last_read_message_id = ? WHERE conversation_id = ? AND user_id = ?'
  ).run(target, Number(conversationId), Number(userId));
  return target;
}

function buildConversationSummary(userId, conversation) {
  const lastMessage = getLastMessage(conversation.id);
  const unread = countUnread(userId, conversation.id);
  let peer = null;
  if (conversation.type === 'private') {
    peer = conversation.members.find((m) => m.userId !== Number(userId)) || null;
  }
  return {
    id: conversation.id,
    type: conversation.type,
    name: conversation.type === 'group' ? conversation.name : peer ? peer.displayName : 'Conversa',
    avatar: conversation.type === 'group' ? conversation.avatar : peer ? peer.avatar : '',
    peer: peer ? { id: peer.userId, username: peer.username, online: peer.online, lastSeen: peer.lastSeen, isBot: peer.isBot } : null,
    unread,
    lastMessage,
    lastActivity: lastMessage ? lastMessage.createdAt : conversation.createdAt,
    createdAt: conversation.createdAt,
    members: conversation.members,
  };
}

function getConversationList(userId) {
  const ids = getConversationIdsForUser(userId);
  const list = ids
    .map((id) => buildConversationSummary(userId, getConversation(id)))
    .filter(Boolean)
    .sort((a, b) => b.lastActivity - a.lastActivity);
  return list;
}

function upsertPushSubscription(userId, subscription) {
  const sub = subscription;
  db.prepare(
    `INSERT INTO push_subscriptions (user_id, endpoint, keys_p256dh, keys_auth, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE SET keys_p256dh = excluded.keys_p256dh, keys_auth = excluded.keys_auth, user_id = excluded.user_id`
  ).run(Number(userId), sub.endpoint, sub.keys.p256dh, sub.keys.auth, now());
}

function deletePushSubscription(endpoint) {
  db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint);
}

function deletePushSubscriptionsByUser(userId) {
  db.prepare('DELETE FROM push_subscriptions WHERE user_id = ?').run(Number(userId));
}

function getPushSubscriptionsByUser(userId) {
  return db
    .prepare('SELECT endpoint, keys_p256dh, keys_auth FROM push_subscriptions WHERE user_id = ?')
    .all(Number(userId))
    .map((r) => ({ endpoint: r.endpoint, keys: { p256dh: r.keys_p256dh, auth: r.keys_auth } }));
}

module.exports = {
  now,
  getUserById,
  getUserByUsername,
  createUser,
  verifyPassword,
  createSession,
  getUserByToken,
  deleteSession,
  searchUsers,
  updateUser,
  setUserPresence,
  findPrivateConversation,
  createConversation,
  addMember,
  removeMember,
  deleteConversation,
  getMemberIds,
  isMember,
  getConversationIdsForUser,
  getConversation,
  updateConversation,
  addMessage,
  getMessage,
  deleteMessageForEveryone,
  markDelivered,
  computeStatus,
  buildMessagePayload,
  getLastMessage,
  getMessages,
  countUnread,
  markRead,
  buildConversationSummary,
  getConversationList,
  ensureBotUser,
  getBotUser,
  ensureBotConversation,
  BOT_USERNAME,
  upsertPushSubscription,
  deletePushSubscription,
  deletePushSubscriptionsByUser,
  getPushSubscriptionsByUser,
};
