export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { query } = req.body || {};

  if (!query || typeof query !== 'string' || query.trim().length === 0) {
    return res.status(400).json({ error: 'A search query is required.' });
  }

  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'API key not configured on the server.' });
  }

  const sanitizedQuery = query.trim().slice(0, 200);

  const systemPrompt = `You are a newsletter research expert specializing in Substack.
You find real, active Substack newsletters that actually exist.
Always return a valid JSON array only — no markdown, no explanations, no other text.`;

  const userPrompt = `Find 10–12 real, active Substack newsletters about: "${sanitizedQuery}"

Return ONLY a JSON array. Each object must have exactly these fields:
- name: string (newsletter name)
- author: string (author/writer name)
- description: string (2–3 sentences about what they cover)
- url: string (full Substack URL, e.g. https://example.substack.com)
- frequency: string (e.g. "Weekly", "Daily", "Twice a week", "Monthly")
- tags: string[] (2–4 relevant topic tags)

Only include newsletters that genuinely exist on Substack. Verify the URLs are real.
Return the JSON array only, nothing else.`;

  try {
    const perplexityRes = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'sonar',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.2,
        max_tokens: 4000,
      }),
    });

    if (!perplexityRes.ok) {
      const errText = await perplexityRes.text();
      console.error('Perplexity API error:', perplexityRes.status, errText);
      return res.status(502).json({
        error: `Search service error (${perplexityRes.status}). Please try again.`,
      });
    }

    const data = await perplexityRes.json();
    const content = data.choices?.[0]?.message?.content || '';

    let newsletters = [];

    // Try direct JSON parse first
    try {
      const parsed = JSON.parse(content);
      newsletters = Array.isArray(parsed) ? parsed : parsed.newsletters || [];
    } catch {
      // Fall back: extract JSON array from text
      const match = content.match(/\[[\s\S]*\]/);
      if (match) {
        newsletters = JSON.parse(match[0]);
      } else {
        console.error('Could not extract JSON from response:', content.slice(0, 500));
        return res.status(502).json({ error: 'Could not parse search results. Please try again.' });
      }
    }

    // Validate and normalise
    newsletters = newsletters
      .filter((n) => n && typeof n === 'object' && n.name && n.url)
      .map((n) => ({
        name: String(n.name).trim(),
        author: String(n.author || '').trim(),
        description: String(n.description || '').trim(),
        url: String(n.url).startsWith('http') ? String(n.url).trim() : `https://${String(n.url).trim()}`,
        frequency: String(n.frequency || 'Varies').trim(),
        tags: Array.isArray(n.tags) ? n.tags.map(String) : [],
      }));

    return res.status(200).json({ newsletters });
  } catch (err) {
    console.error('Search handler error:', err);
    return res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
  }
}
