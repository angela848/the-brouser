const { setCors, requirePost, getApiKey, callPerplexity, extractJson } = require('./_lib');

module.exports = async function handler(req, res) {
  setCors(res);
  if (!requirePost(req, res)) return;

  const { query, excludeMedia = true, excludeTrade = true } = req.body || {};
  if (!query || typeof query !== 'string' || !query.trim()) {
    return res.status(400).json({ error: 'A search query is required.' });
  }

  const apiKey = getApiKey(res);
  if (!apiKey) return;

  const sanitizedQuery = query.trim().slice(0, 200);

  const user = `You are helping a PR professional find independent newsletters to pitch for the topic: "${sanitizedQuery}".

These are newsletters written by independent creators for a CONSUMER or ENTHUSIAST audience — NOT trade publications, NOT B2B industry news, NOT corporate newsletters.

Think broadly about the topic. For example:
- "hotels" → travel newsletters, luxury lifestyle, weekend escape guides, design-forward travel writing
- "food" → recipe writers, restaurant criticism, culinary culture, food travel
- "finance" → personal finance, investing for individuals, money mindset

Search for:
1. Newsletters whose name references the topic (e.g. "Hotels Above Par")
2. Travel/lifestyle/culture newsletters that REGULARLY feature this topic even if the name doesn't reference it (e.g. Fathom for hotels)
3. Newsletters in adjacent lifestyle categories where this topic naturally appears

${excludeTrade ? 'EXCLUDE: trade publications, industry news, B2B newsletters, corporate brand newsletters. Focus on consumer-facing and enthusiast newsletters.' : 'Include trade and B2B newsletters if relevant.'}
${excludeMedia ? 'EXCLUDE major media outlets (NYT, WSJ, Condé Nast, Hearst, etc). Independent creators only.' : ''}

Spread results across platforms: Substack, beehiiv, Ghost, Buttondown, Kit, Paragraph. Do NOT cluster on one platform.

Return up to 20 results as ONLY a valid JSON array of objects with exactly two fields: "name" (string) and "url" (string, full URL).
No markdown, no explanations, no other text — just the JSON array.`;

  try {
    const perplexityRes = await callPerplexity(apiKey, {
      system: 'You are a PR research expert helping find independent consumer-facing newsletters for media outreach. Prioritize lifestyle, culture, and enthusiast newsletters over trade or industry publications. Return only valid JSON arrays, nothing else.',
      user,
      maxTokens: 3000,
    });

    if (!perplexityRes.ok) {
      const errText = await perplexityRes.text();
      console.error('Perplexity API error:', perplexityRes.status, errText);
      return res.status(502).json({ error: `Search service error (${perplexityRes.status}). Please try again.` });
    }

    const data = await perplexityRes.json();
    const content = data.choices?.[0]?.message?.content || '';

    const parsed = extractJson(content, 'array');
    if (!parsed) {
      console.error('Could not parse JSON from response:', content.slice(0, 500));
      return res.status(502).json({ error: 'Could not parse search results. Please try again.' });
    }

    const newsletters = parsed
      .filter((n) => n && typeof n === 'object' && n.name && n.url)
      .map((n) => ({
        name: String(n.name).trim(),
        url: String(n.url).startsWith('http') ? String(n.url).trim() : `https://${String(n.url).trim()}`,
      }));

    return res.status(200).json({ newsletters });
  } catch (err) {
    console.error('Search handler error:', err);
    return res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
  }
};
