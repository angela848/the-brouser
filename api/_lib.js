const PERPLEXITY_URL = 'https://api.perplexity.ai/v1/sonar';

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

// Returns false (and sends a response) if the request should not proceed.
function requirePost(req, res) {
  if (req.method === 'OPTIONS') { res.status(200).end(); return false; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return false; }
  return true;
}

function getApiKey(res) {
  const key = process.env.PERPLEXITY_API_KEY;
  if (!key) { res.status(500).json({ error: 'API key not configured on the server.' }); return null; }
  return key;
}

async function callPerplexity(apiKey, { system, user, maxTokens = 1500 }) {
  return fetch(PERPLEXITY_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'sonar',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0.2,
      max_tokens: maxTokens,
      web_search_options: { search_context_size: 'high' },
    }),
  });
}

// Parse JSON from an LLM response string.
// type: 'object' | 'array' — determines the fallback regex.
function extractJson(content, type = 'object') {
  try {
    const parsed = JSON.parse(content);
    if (type === 'array') return Array.isArray(parsed) ? parsed : (parsed.newsletters ?? []);
    return parsed;
  } catch {
    const pattern = type === 'array' ? /\[[\s\S]*\]/ : /\{[\s\S]*\}/;
    const match = content.match(pattern);
    if (!match) return null;
    try { return JSON.parse(match[0]); } catch { return null; }
  }
}

module.exports = { setCors, requirePost, getApiKey, callPerplexity, extractJson };
