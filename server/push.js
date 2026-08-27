'use strict';

const fs = require('node:fs');
const path = require('node:path');
const webpush = require('web-push');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const VAPID_FILE = path.join(DATA_DIR, 'vapid.json');
const VAPID_SUBJECT = 'mailto:admin@pulse.local';

function loadOrCreateVapidKeys() {
  try {
    if (fs.existsSync(VAPID_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(VAPID_FILE, 'utf8'));
      if (parsed.publicKey && parsed.privateKey) return parsed;
    }
  } catch (err) {
    console.warn('push: VAPID file inválido, regenerando.', err.message);
  }
  const keys = webpush.generateVAPIDKeys();
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(VAPID_FILE, JSON.stringify(keys, null, 2), { mode: 0o600 });
  return keys;
}

const vapid = loadOrCreateVapidKeys();
webpush.setVapidDetails(VAPID_SUBJECT, vapid.publicKey, vapid.privateKey);

function getPublicKey() {
  return vapid.publicKey;
}

function normalizeSubscription(sub) {
  if (!sub || typeof sub.endpoint !== 'string' || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) return null;
  return {
    endpoint: sub.endpoint,
    keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth },
  };
}

async function sendPush(subscription, payload) {
  const sub = normalizeSubscription(subscription);
  if (!sub) return { ok: false, reason: 'invalid_subscription' };
  try {
    await webpush.sendNotification(
      sub,
      JSON.stringify(payload),
      { TTL: 60 * 5, urgency: 'high' }
    );
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err.statusCode === 404 || err.statusCode === 410 ? 'gone' : 'error', code: err.statusCode };
  }
}

module.exports = { getPublicKey, normalizeSubscription, sendPush };
