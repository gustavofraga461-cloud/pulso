'use strict';

const TOKEN_KEY = 'pulse_token';

const Storage = {
  getToken() {
    return localStorage.getItem(TOKEN_KEY);
  },
  setToken(t) {
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
  },
  getPendingConv() {
    return localStorage.getItem('pulse_pending_conv');
  },
  setPendingConv(id) {
    if (id) localStorage.setItem('pulse_pending_conv', String(id));
    else localStorage.removeItem('pulse_pending_conv');
  },
  consumePendingConv() {
    const v = localStorage.getItem('pulse_pending_conv');
    localStorage.removeItem('pulse_pending_conv');
    return v;
  },
};

class ApiError extends Error {
  constructor(message, code, status) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const API = {
  async request(method, url, body) {
    const headers = {};
    const token = Storage.getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    let payload;
    if (body instanceof FormData) {
      payload = body;
    } else if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const res = await fetch(url, { method, headers, body: payload });
    let data = {};
    try {
      data = await res.json();
    } catch (_e) {
      /* no body */
    }
    if (!res.ok) {
      throw new ApiError(data.message || 'Algo deu errado. Tente novamente.', data.error || 'erro', res.status);
    }
    return data;
  },

  get(url) {
    return this.request('GET', url);
  },
  post(url, body) {
    return this.request('POST', url, body);
  },
  put(url, body) {
    return this.request('PUT', url, body);
  },
  delete(url) {
    return this.request('DELETE', url);
  },

  signup(username, password, displayName, bio) {
    return this.post('/api/auth/signup', { username, password, displayName, bio });
  },
  login(username, password) {
    return this.post('/api/auth/login', { username, password });
  },
  logout() {
    return this.post('/api/auth/logout');
  },
  me() {
    return this.get('/api/auth/me');
  },

  searchUsers(q) {
    return this.get(`/api/users?q=${encodeURIComponent(q)}`);
  },
  getUser(id) {
    return this.get(`/api/users/${id}`);
  },
  updateMe(fields) {
    return this.put('/api/users/me', fields);
  },

  conversations() {
    return this.get('/api/conversations');
  },
  conversation(id) {
    return this.get(`/api/conversations/${id}`);
  },
  createPrivate(userId) {
    return this.post('/api/conversations', { type: 'private', userId });
  },
  createGroup(name, memberIds, avatar) {
    return this.post('/api/conversations', { type: 'group', name, memberIds, avatar });
  },
  messages(conversationId, beforeId, limit = 50) {
    const q = beforeId ? `?beforeId=${beforeId}&limit=${limit}` : `?limit=${limit}`;
    return this.get(`/api/conversations/${conversationId}/messages${q}`);
  },
  sendMessage(conversationId, type, content, replyToId) {
    return this.post(`/api/conversations/${conversationId}/messages`, { type, content, replyToId });
  },
  markRead(conversationId, messageId) {
    return this.post(`/api/conversations/${conversationId}/read`, { messageId });
  },
  addGroupMember(conversationId, userId) {
    return this.post(`/api/conversations/${conversationId}/members`, { userId });
  },
  updateGroupAvatar(conversationId, avatar) {
    return this.put(`/api/conversations/${conversationId}/avatar`, { avatar });
  },
  deleteMessage(conversationId, messageId) {
    return this.request('DELETE', `/api/conversations/${conversationId}/messages/${messageId}`);
  },
  editMessage(conversationId, messageId, content) {
    return this.request('PUT', `/api/conversations/${conversationId}/messages/${messageId}`, { content });
  },
  setReaction(conversationId, messageId, emoji) {
    return this.request('PUT', `/api/conversations/${conversationId}/messages/${messageId}/reaction`, { emoji });
  },
  setPinned(conversationId, pinned) {
    return this.request('PUT', `/api/conversations/${conversationId}/pin`, { pinned });
  },
  setMuted(conversationId, muted) {
    return this.request('PUT', `/api/conversations/${conversationId}/mute`, { muted });
  },
  leaveGroup(conversationId) {
    return this.post(`/api/conversations/${conversationId}/leave`);
  },
  deleteConversation(conversationId) {
    return this.request('DELETE', `/api/conversations/${conversationId}`);
  },
  blockUser(userId) {
    return this.post(`/api/users/${userId}/block`);
  },
  unblockUser(userId) {
    return this.post(`/api/users/${userId}/unblock`);
  },
  getBlockStatus(userId) {
    return this.get(`/api/users/${userId}/blocked`);
  },
  reportUser(userId, reason) {
    return this.post(`/api/users/${userId}/report`, { reason });
  },
  deleteMyAccount() {
    return this.request('DELETE', '/api/users/me');
  },
  upload(file, filename) {
    const fd = new FormData();
    if (filename) fd.append('file', file, filename);
    else fd.append('file', file);
    return this.post('/api/upload', fd);
  },

  getVapidPublicKey() {
    return this.get('/api/push/vapid-public-key');
  },
  pushSubscribe(subscription) {
    return this.post('/api/push/subscribe', { subscription });
  },
  pushUnsubscribe(endpoint) {
    return this.post('/api/push/unsubscribe', { endpoint });
  },
};

const Socket = {
  socket: null,
  connect(token) {
    this.socket = io({ auth: { token }, transports: ['websocket', 'polling'] });
    return this.socket;
  },
  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  },
};
