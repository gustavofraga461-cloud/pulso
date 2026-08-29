'use strict';

// Integração do bot FragaIA com a API do Google Gemini (tem cota gratuita,
// sem cartão de crédito: https://aistudio.google.com).
// A chave NUNCA deve ficar escrita no código — ela vem só da variável de
// ambiente GEMINI_API_KEY, configurada no painel do Render (Environment).

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';

// O Google vem trocando os nomes dos modelos com frequência em 2026.
// Se a pessoa configurar GEMINI_MODEL, só esse nome é tentado; senão,
// tentamos essa lista em ordem até um funcionar, e guardamos qual deu certo.
const MODEL_CANDIDATES = process.env.GEMINI_MODEL
  ? [process.env.GEMINI_MODEL]
  : ['gemini-flash-latest', 'gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-pro-latest'];

let workingModel = null;

const SYSTEM_PROMPT = [
  'Você é o FragaIA, o assistente de inteligência artificial que mora dentro do app de mensagens Pulse.',
  'Responda sempre em português do Brasil, de um jeito simpático, direto e natural, como numa conversa de chat comum.',
  'Não use formatação markdown pesada (sem #, sem **, sem listas numeradas longas) porque suas respostas aparecem como balões de mensagem simples.',
  'Pode usar emojis com moderação. Mantenha as respostas curtas ou médias, do tamanho de uma mensagem de chat normal, a não ser que a pessoa peça algo mais detalhado.',
].join(' ');

function isConfigured() {
  return !!GEMINI_API_KEY;
}

async function callGemini(model, body) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  return fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // Chaves novas do Google (formato "AQ...") só funcionam nesse cabeçalho,
      // não no jeito antigo de colar a chave na URL (?key=...).
      'X-goog-api-key': GEMINI_API_KEY,
    },
    body: JSON.stringify(body),
  });
}

// history: array de { role: 'user' | 'model', text: string }, do mais antigo pro mais novo
async function generateReply(history) {
  if (!GEMINI_API_KEY) {
    return 'Ainda não me configuraram direito por aqui 🙈 Peça pra quem administra o Pulse definir a variável de ambiente GEMINI_API_KEY no servidor (é grátis, em aistudio.google.com).';
  }

  const contents = history
    .filter((m) => m.text && m.text.trim())
    .map((m) => ({ role: m.role, parts: [{ text: m.text }] }));

  if (!contents.length) {
    return 'Oi! Sou o FragaIA 🤖 Pode mandar sua pergunta que eu respondo.';
  }

  const body = {
    contents,
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    generationConfig: { maxOutputTokens: 800, temperature: 0.85 },
  };

  const modelsToTry = workingModel ? [workingModel] : MODEL_CANDIDATES;
  let lastStatus = 0;
  let lastErrText = '';

  for (const model of modelsToTry) {
    let res;
    try {
      res = await callGemini(model, body);
    } catch (err) {
      console.error('Falha de rede ao chamar o Gemini:', err.message);
      return 'Não consegui me conectar à minha IA agora. Tenta de novo daqui a pouco?';
    }

    if (res.ok) {
      workingModel = model; // acerta esse modelo pras próximas mensagens, evita ficar testando de novo
      let data;
      try {
        data = await res.json();
      } catch (err) {
        return 'Recebi uma resposta estranha da minha IA. Tenta de novo?';
      }
      const candidate = data && data.candidates && data.candidates[0];
      const parts = candidate && candidate.content && candidate.content.parts;
      const text = Array.isArray(parts) ? parts.map((p) => p.text || '').join('').trim() : '';
      if (!text) {
        if (candidate && candidate.finishReason === 'SAFETY') {
          return 'Prefiro não responder isso 🙏 Bora falar de outra coisa?';
        }
        return 'Não consegui pensar em nada bom agora. Pode reformular a pergunta?';
      }
      return text;
    }

    lastStatus = res.status;
    lastErrText = await res.text().catch(() => '');
    console.error(`Erro na API do Gemini (modelo "${model}"):`, res.status, lastErrText);

    // 404 costuma ser "esse nome de modelo não existe" — vale tentar o próximo da lista.
    // Pra qualquer outro erro (401, 403, 429...) não adianta trocar de modelo, então já para.
    if (res.status !== 404) break;
  }

  if (lastStatus === 429) {
    return 'Bati no limite de uso gratuito da minha IA por agora. Tenta de novo em alguns instantes 🙏';
  }
  if (lastStatus === 401 || lastStatus === 403) {
    return 'Minha chave de acesso à IA parece inválida ou sem permissão. Peça pra quem administra o Pulse conferir a variável GEMINI_API_KEY no Render.';
  }
  return 'Deu um errinho aqui tentando pensar na resposta. Pode tentar de novo?';
}

module.exports = { isConfigured, generateReply };

