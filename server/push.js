'use strict';

const fs = require('node:fs');
const path = require('node:path');
const webpush = require('web-push');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const VAPID_FILE = path.join(DATA_DIR, 'vapid.json');
const VAPID_SUBJECT = 'mailto:admin@pulse.local';

function loadOrCreateVapidKeys() {
  // Prioridade 1: variáveis de ambiente (VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY).
  // É o único jeito das chaves sobreviverem a um redeploy em servidores sem
  // disco persistente (como o plano free do Render) — sem isso, toda vez que
  // o servidor reinicia as chaves mudam e TODAS as notificações já registradas
  // pelos usuários param de funcionar silenciosamente.
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    return { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY, source: 'env' };
  }

  try {
    if (fs.existsSync(VAPID_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(VAPID_FILE, 'utf8'));
      if (parsed.publicKey && parsed.privateKey) return { ...parsed, source: 'file' };
    }
  } catch (err) {
    console.warn('push: VAPID file inválido, regenerando.', err.message);
  }
  const keys = webpush.generateVAPIDKeys();
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(VAPID_FILE, JSON.stringify(keys, null, 2), { mode: 0o600 });
  return { ...keys, source: 'file-new' };
}

const vapid = loadOrCreateVapidKeys();
webpush.setVapidDetails(VAPID_SUBJECT, vapid.publicKey, vapid.privateKey);

if (vapid.source !== 'env') {
  console.warn(
    '\n⚠️  push: as chaves VAPID NÃO estão fixadas por variável de ambiente.\n' +
    '   Em servidores sem disco persistente, elas vão mudar a cada deploy e\n' +
    '   TODAS as notificações já registradas pelos usuários vão parar de chegar.\n' +
    '   Para corrigir de vez, defina no Render (Environment):\n' +
    `   VAPID_PUBLIC_KEY=${vapid.publicKey}\n` +
    `   VAPID_PRIVATE_KEY=${vapid.privateKey}\n`
  );
}

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
    const gone = err.statusCode === 404 || err.statusCode === 410;
    // 401/403 aqui geralmente quer dizer "essa inscrição foi feita com uma chave
    // VAPID antiga que não existe mais" — o sintoma exato do bug das chaves não fixadas.
    console.error(`push: falha ao enviar (status ${err.statusCode || '?'})${gone ? ' — inscrição expirada, será removida' : ''}:`, err.body || err.message);
    return { ok: false, reason: gone ? 'gone' : 'error', code: err.statusCode };
  }
}

module.exports = { getPublicKey, normalizeSubscription, sendPush };
