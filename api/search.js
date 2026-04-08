const { setCors, requirePost, getApiKey, callPerplexity, extractJson } = require('./_lib');

module.exports = async function handler(req, res) {
  setCors(res);
  if (!requirePost(req, res)) return;

  const { query, excludeMedia = true } = req.body || {};
  if (!query || typeof query !== 'string' || !query.trim()) {
    return res.status(400).json({ error: 'A search query is required.' });
  }

  const apiKey = getApiKey(res);
  if (!apiKey) return;

  const sanitizedQuery = query.trim().slice(0, 200);

  const user = `Find up to 20 popular and relevant self-published newsletters for the query: "${sanitizedQuery}".
Use web search to ensure these are currently active and popular.

Prioritize platforms: Substack, beehiiv, Ghost, Buttondown, Kit (formerly ConvertKit), Paragraph.
Include diverse finds (not just the top 1). Prioritize newsletters with strong engagement and unique perspectives.
${excludeMedia ? 'EXCLUDE major traditional media outlets (NYT, WSJ, Washington Post, etc). Focus on independent creators.' : ''}

Return ONLY a valid JSON array of objects with exactly two fields: "name" (string) and "url" (string, full URL).
No markdown, no explanations, no other text — just the JSON array.`;

  try {
    const perplexityRes = await callPerplexity(apiKey, {
      system: 'You are a newsletter research expert. Find real, active self-published newsletters. Return only valid JSON arrays, nothing else.',
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
