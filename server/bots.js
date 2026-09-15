'use strict';

// Motor de automação do Pulse.
//
// Cada usuário pode ligar uma automação na própria conta: quando alguém manda
// mensagem pra ele (numa conversa privada, ou num grupo se ele marcar o bot
// pra responder lá também), o Pulse decide sozinho uma resposta e a envia
// como se fosse o próprio usuário — tipo um "responde automático".
//
// Duas fontes de regras:
//   - "preset": um dos bots prontos definidos aqui embaixo (loja, ausente...).
//   - "custom": regras que o próprio usuário escreveu nas configurações.
//
// IMPORTANTE: isso NUNCA executa código enviado pelo usuário. As regras
// customizadas são só pares de "gatilho" + "resposta" (dado, não código),
// interpretados por este motor. Rodar JS arbitrário de usuários no servidor
// seria uma porta aberta pra o servidor inteiro ser comprometido, então esse
// caminho foi propositalmente deixado de fora.

function stripAccents(str) {
  return String(str || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function normalize(str) {
  return stripAccents(String(str || '')).toLowerCase().trim();
}

// ---------- bots prontos da loja ----------
const PRESETS = {
  atendimento_loja: {
    id: 'atendimento_loja',
    label: 'Atendimento de loja',
    description: 'Responde perguntas comuns (horário, entrega, pagamento) e chama um humano quando não sabe.',
    rules: [
      { pattern: 'horario', response: 'Funcionamos de segunda a sábado, das 9h às 18h. Aos domingos ficamos fechados. 🕒' },
      { pattern: 'entrega', response: 'Fazemos entrega em até 3 dias úteis pra região. O frete é calculado no fechamento do pedido. 📦' },
      { pattern: 'preco', response: 'Os preços variam por produto — me diz qual item te interessou que eu vejo pra você, ou aguarde um atendente. 💰' },
      { pattern: 'pagamento', response: 'Aceitamos Pix, cartão de crédito e débito. 💳' },
      { pattern: 'endereco', response: 'Estamos localizados no centro da cidade. Posso mandar o endereço completo se precisar!' },
      { pattern: 'atendente', response: 'Já vou chamar alguém da equipe pra te ajudar por aqui, só um instante! 🙋' },
    ],
    defaultReply: 'Oi! Já registrei sua mensagem e alguém da equipe te responde em breve. Se quiser, pode perguntar sobre horário, entrega, preço, pagamento ou endereço que eu já adianto! 😊',
  },
  ausente: {
    id: 'ausente',
    label: 'Ausente / fora do horário',
    description: 'Avisa que você está fora e não vai responder na hora.',
    rules: [],
    defaultReply: 'Oi! No momento estou ausente e não vou conseguir responder na hora, mas assim que eu voltar te respondo. Obrigado pela paciência! 🙏',
  },
  faq_geral: {
    id: 'faq_geral',
    label: 'Perguntas frequentes',
    description: 'Responde dúvidas genéricas sobre como falar com você.',
    rules: [
      { pattern: 'oi', response: 'Oi! Tudo bem? Já te respondo assim que possível.' },
      { pattern: 'bom dia', response: 'Bom dia! Assim que eu puder, te respondo com calma.' },
      { pattern: 'boa tarde', response: 'Boa tarde! Já anotei sua mensagem, te retorno em breve.' },
      { pattern: 'boa noite', response: 'Boa noite! Te respondo assim que eu ver a mensagem.' },
    ],
    defaultReply: 'Recebi sua mensagem! Te respondo assim que puder. 👍',
  },
};

function listPresets() {
  return Object.values(PRESETS).map((p) => ({ id: p.id, label: p.label, description: p.description }));
}

// ---------- regras customizadas do usuário ----------
// Cada regra: { pattern: string, response: string }
// "pattern" é sempre tratado como "a mensagem contém esse trecho" (sem
// distinguir maiúsculas/minúsculas nem acento) — simples de escrever e
// entender, sem precisar aprender regex nem sintaxe de código.
const MAX_CUSTOM_RULES = 30;
const MAX_RULE_LENGTH = 300;

function sanitizeRules(rawRules) {
  if (!Array.isArray(rawRules)) return [];
  return rawRules
    .slice(0, MAX_CUSTOM_RULES)
    .map((r) => ({
      pattern: String((r && r.pattern) || '').slice(0, MAX_RULE_LENGTH).trim(),
      response: String((r && r.response) || '').slice(0, MAX_RULE_LENGTH).trim(),
    }))
    .filter((r) => r.pattern && r.response);
}

function matchesRule(rule, normalizedText) {
  const pattern = normalize(rule.pattern);
  if (!pattern) return false;
  return normalizedText.includes(pattern);
}

// automation: linha do banco (ver db.js) já normalizada em objeto JS
// context: { isGroup: bool, mentioned: bool }
function pickResponse(automation, messageText, context) {
  if (!automation || !automation.enabled) return null;
  if (context.isGroup) {
    if (automation.replyInGroups === 'off') return null;
    if (automation.replyInGroups === 'mention' && !context.mentioned) return null;
  }

  let rules = [];
  let defaultReply = '';

  if (automation.mode === 'preset') {
    const preset = PRESETS[automation.presetId];
    if (!preset) return null;
    rules = preset.rules;
    defaultReply = preset.defaultReply;
  } else {
    rules = sanitizeRules(automation.rules);
    defaultReply = String(automation.defaultReply || '').slice(0, MAX_RULE_LENGTH).trim();
  }

  const normalizedText = normalize(messageText);
  for (const rule of rules) {
    if (matchesRule(rule, normalizedText)) return rule.response;
  }
  return defaultReply || null;
}

module.exports = { PRESETS, listPresets, sanitizeRules, pickResponse, MAX_CUSTOM_RULES, MAX_RULE_LENGTH };
