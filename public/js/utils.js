'use strict';

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') {
      node.addEventListener(k.slice(2), v);
    } else if (k === 'hidden') {
      node.hidden = !!v;
    } else if (v !== undefined && v !== null && v !== false) {
      node.setAttribute(k, v === true ? '' : v);
    }
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

function two(n) {
  return String(n).padStart(2, '0');
}

function formatClock(ts) {
  const d = new Date(ts);
  return `${two(d.getHours())}:${two(d.getMinutes())}`;
}

function startOfDay(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function formatConvTime(ts) {
  const now = Date.now();
  const d = new Date(ts);
  const diffDays = Math.floor((startOfDay(now) - startOfDay(ts)) / 86400000);
  if (diffDays === 0) return formatClock(ts);
  if (diffDays === 1) return 'Ontem';
  const weekday = ['dom.', 'seg.', 'ter.', 'qua.', 'qui.', 'sex.', 'sáb.'][d.getDay()];
  if (diffDays < 7) return weekday;
  return `${two(d.getDate())}/${two(d.getMonth() + 1)}`;
}

function formatDateLabel(ts) {
  const now = Date.now();
  const diffDays = Math.floor((startOfDay(now) - startOfDay(ts)) / 86400000);
  const d = new Date(ts);
  const dateStr = `${two(d.getDate())}/${two(d.getMonth() + 1)}/${d.getFullYear()}`;
  if (diffDays === 0) return `Hoje, ${formatClock(ts)}`;
  if (diffDays === 1) return `Ontem, ${formatClock(ts)}`;
  return `${dateStr} ${formatClock(ts)}`;
}

function formatLastSeen(ts, online) {
  if (online) return 'online';
  if (!ts) return 'offline';
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'visto agora';
  if (min < 60) return `visto há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `visto há ${h} h`;
  const days = Math.floor(h / 24);
  if (days === 1) return 'visto ontem';
  const d = new Date(ts);
  return `visto em ${two(d.getDate())}/${two(d.getMonth() + 1)}`;
}

function initialsOf(name) {
  const parts = String(name || '?').trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => (p[0] || '').toUpperCase()).join('') || '?';
}

const AVATAR_GRADIENTS = [
  ['#1d4ed8', '#4d86ff'],
  ['#7c3aed', '#a78bfa'],
  ['#0e7490', '#22d3ee'],
  ['#b45309', '#fbbf24'],
  ['#be123c', '#fb7185'],
  ['#15803d', '#4ade80'],
];

function avatarGradient(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_GRADIENTS[h % AVATAR_GRADIENTS.length];
}

function initialsDataUri(name, size = 96) {
  const [c1, c2] = avatarGradient(name);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs><rect width="${size}" height="${size}" fill="url(#g)"/><text x="50%" y="54%" font-family="Segoe UI, system-ui, sans-serif" font-size="${Math.round(size * 0.44)}" font-weight="600" fill="rgba(255,255,255,0.94)" text-anchor="middle" dominant-baseline="middle">${esc(initialsOf(name))}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function debounced(fn, ms) {
  return debounce(fn, ms);
}

function messagePreviewText(message, myUserId) {
  if (!message) return '';
  if (message.type === 'system') return message.content || '';
  const prefix = message.senderId === myUserId ? 'Você: ' : '';
  if (message.deleted) return `${prefix}Mensagem apagada`;
  if (message.type === 'image') return `${prefix}Foto`;
  if (message.type === 'audio') return `${prefix}Áudio`;
  return `${prefix}${message.content}`;
}
