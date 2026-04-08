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

  const tradeRule = excludeTrade
    ? 'Exclude trade publications, B2B industry newsletters, and corporate brand newsletters.'
    : 'Include trade and B2B newsletters where relevant.';
  const mediaRule = excludeMedia
    ? 'Exclude major media brands (NYT, WSJ, Condé Nast, Hearst, etc). Independent creators only.'
    : '';

  const system = `You are a PR research expert. Your job is to find real, active, independent newsletters that a PR professional could pitch.
Think broadly about topics — "hotels" means travel writers, luxury lifestyle, weekend getaways, design travel, not just newsletters with "hotel" in the name.
${tradeRule}
${mediaRule}
Spread results across platforms: Substack, beehiiv, Ghost, Buttondown, Kit, Paragraph.
Return ONLY a valid JSON array. No explanation, no markdown, no other text before or after the array.`;

  const user = `Find up to 20 independent newsletters related to the topic: "${sanitizedQuery}".
Include newsletters whose name references this topic AND newsletters in travel/lifestyle/culture that regularly cover it.
Return as a JSON array where each item has exactly: "name" (string) and "url" (string, full URL).`;

  try {
    const perplexityRes = await callPerplexity(apiKey, {
      system,
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
