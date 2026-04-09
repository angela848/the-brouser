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

  const system = `You are an expert media list researcher for PR professionals. Your job is to find real, currently active, independently published newsletters that a publicist could pitch stories to.

SEARCH STRATEGY — cast a wide net:
1. Search Substack directly for newsletters about this topic and adjacent topics.
2. Search beehiiv, Ghost, Buttondown, Kit, and Paragraph directories.
3. Think laterally: for "hotels" also search boutique travel, luxury lifestyle, design travel, city guides, food & drink travel, weekend getaways, interior design, hospitality culture. For "skincare" also search beauty, wellness, clean living, dermatology, self-care.
4. Include newsletters that REGULARLY COVER this topic even if it's not their sole focus (e.g., a lifestyle newsletter that frequently features hotel reviews).
5. Include niche curators and tastemakers, not just topic-specific publications.

${tradeRule}
${mediaRule}

You MUST return at least 15 results — aim for 20. Search multiple times if needed.
Return ONLY a valid JSON array. No explanation, no markdown, no other text before or after the array.`;

  const user = `Find 20 independent newsletters related to: "${sanitizedQuery}".

Search broadly across these categories:
- Newsletters dedicated to this topic (e.g., with the topic in their name or tagline)
- Lifestyle, culture, and travel newsletters that regularly cover this topic
- Niche curators and tastemaker newsletters in adjacent spaces
- Regional or city-specific newsletters that touch on this topic

For each newsletter, provide the actual working URL (e.g., their Substack URL, custom domain, or homepage).
Return as a JSON array where each item has exactly: "name" (string) and "url" (string, full URL).`;

  try {
    const perplexityRes = await callPerplexity(apiKey, {
      system,
      user,
      maxTokens: 4000,
    });

    if (!perplexityRes.ok) {
      const errText = await perplexityRes.text();
      console.error('Perplexity API error:', perplexityRes.status, errText);
      return res.status(502).json({ error: `Search service error (${perplexityRes.status}). Please try again.` });
    }

    const data = await perplexityRes.json();
    console.log('Perplexity response keys:', Object.keys(data));
    const content = data.choices?.[0]?.message?.content || data.output || '';
    console.log('Raw content (first 500):', String(content).slice(0, 500));

    if (!content) {
      console.error('No content in Perplexity response. Full response:', JSON.stringify(data).slice(0, 1000));
      return res.status(502).json({ error: 'Search returned no content. Please try again.' });
    }

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
