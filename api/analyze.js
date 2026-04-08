module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { name, url } = req.body || {};
  if (!name || !url) return res.status(400).json({ error: 'Newsletter name and URL are required.' });

  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key not configured on the server.' });

  // ── Substack subscriber lookup (runs in parallel with Perplexity) ───────────
  const fetchSubstackSubscribers = async () => {
    try {
      const hostname = new URL(url).hostname; // e.g. found.substack.com
      if (!hostname.endsWith('.substack.com')) return null;

      const subdomain = hostname.replace('.substack.com', '');

      // Try the publication homepage API
      const apiRes = await fetch(
        `https://${subdomain}.substack.com/api/v1/publication`,
        { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BrouserBot/1.0)' } }
      );

      if (!apiRes.ok) {
        // Fallback: try the reader-facing homepage endpoint
        const homeRes = await fetch(
          `https://${subdomain}.substack.com/api/v1/homepage`,
          { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BrouserBot/1.0)' } }
        );
        if (!homeRes.ok) return null;
        const home = await homeRes.json();
        return extractCount(home);
      }

      const pub = await apiRes.json();
      return extractCount(pub);
    } catch {
      return null;
    }
  };

  // Pull subscriber count from wherever Substack puts it in the response
  const extractCount = (data) => {
    const candidates = [
      data?.subscriber_count,
      data?.publication?.subscriber_count,
      data?.publication?.reader_count,
      data?.publication?.free_subscriber_count,
      data?.reader_count,
      data?.free_subscriber_count,
      data?.stats?.subscriber_count,
    ];
    for (const val of candidates) {
      if (typeof val === 'number' && val > 0) return val;
    }
    return null;
  };

  const formatCount = (n) => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
    if (n >= 1_000)     return `${Math.round(n / 1_000)}K`;
    return String(n);
  };

  // ── Perplexity deep analysis ─────────────────────────────────────────────────
  const userPrompt = `Perform a deep analysis of the newsletter "${name}" at ${url}.
Search the web for the most current information available about this newsletter.

Return ONLY a valid JSON object with exactly these fields — no markdown, no other text:
{
  "theme": "One sentence summary of the niche/theme",
  "reach": "Subscriber count estimate — use a number if known, otherwise '10k+', '50k+', 'Unknown', etc.",
  "engagement": "Low" | "Medium" | "High",
  "engagement_score": 1-10 number rating engagement quality,
  "contact": "Publisher email address or contact page URL. If unknown, write 'Not found'.",
  "location": "Author city/state/country or timezone. If unknown, write 'Not found'.",
  "muckrack_url": "Full URL to author's Muck Rack profile, or 'Not found'",
  "pr_insights": "2-3 sentences: Does the author accept pitches? What topics do they cover? Any known pitch preferences?",
  "publishing_insights": "2-3 sentences: Do they offer sponsorships or ads? What is the brand/advertiser vibe?",
  "categories": ["category1", "category2", "category3"],
  "frequency": "e.g. Weekly, Daily, Bi-weekly, Monthly",
  "language": "Primary language of the newsletter"
}`;

  try {
    // Run both in parallel
    const [perplexityRes, substackCount] = await Promise.all([
      fetch('https://api.perplexity.ai/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'sonar',
          messages: [
            { role: 'system', content: 'You are a PR research expert analyzing newsletters. Search the web for accurate, current information. Return only valid JSON objects, nothing else.' },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.2,
          max_tokens: 1500,
        }),
      }),
      fetchSubstackSubscribers(),
    ]);

    if (!perplexityRes.ok) {
      const errText = await perplexityRes.text();
      console.error('Perplexity API error (analyze):', perplexityRes.status, errText);
      return res.status(502).json({ error: `Analysis service error (${perplexityRes.status}). Please try again.` });
    }

    const data = await perplexityRes.json();
    const content = data.choices?.[0]?.message?.content || '';

    let analysis = {};
    try {
      analysis = JSON.parse(content);
    } catch {
      const match = content.match(/\{[\s\S]*\}/);
      if (match) {
        analysis = JSON.parse(match[0]);
      } else {
        console.error('Could not parse analysis JSON:', content.slice(0, 500));
        return res.status(502).json({ error: 'Could not parse analysis results. Please try again.' });
      }
    }

    const result = {
      theme: analysis.theme || 'Not available',
      reach: String(analysis.reach || 'Unknown'),
      reach_verified: false,   // true = came directly from Substack
      engagement: analysis.engagement || 'Unknown',
      engagement_score: Number(analysis.engagement_score) || 0,
      contact: analysis.contact || 'Not found',
      location: analysis.location || 'Not found',
      muckrack_url: analysis.muckrack_url || 'Not found',
      pr_insights: analysis.pr_insights || 'Not available',
      publishing_insights: analysis.publishing_insights || 'Not available',
      categories: Array.isArray(analysis.categories) ? analysis.categories : [],
      frequency: analysis.frequency || 'Unknown',
      language: analysis.language || 'English',
    };

    // Override reach with verified Substack number if we got one
    if (substackCount) {
      result.reach = formatCount(substackCount);
      result.reach_verified = true;
    }

    return res.status(200).json({ analysis: result });
  } catch (err) {
    console.error('Analyze handler error:', err);
    return res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
  }
};
