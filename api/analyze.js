const { setCors, requirePost, getApiKey, callPerplexity, extractJson } = require('./_lib');

const SUBSTACK_HEADERS = { 'User-Agent': 'Mozilla/5.0 (compatible; BrouserBot/1.0)' };

async function fetchSubstackSubscribers(url) {
  try {
    const hostname = new URL(url).hostname;
    if (!hostname.endsWith('.substack.com')) return null;

    const base = `https://${hostname}/api/v1`;

    // Try both endpoints in parallel — take whichever succeeds first
    const [pubRes, homeRes] = await Promise.allSettled([
      fetch(`${base}/publication`, { headers: SUBSTACK_HEADERS }),
      fetch(`${base}/homepage`,    { headers: SUBSTACK_HEADERS }),
    ]);

    for (const result of [pubRes, homeRes]) {
      if (result.status === 'fulfilled' && result.value.ok) {
        const data = await result.value.json();
        const count = extractCount(data);
        if (count) return count;
      }
    }
    return null;
  } catch {
    return null;
  }
}

function extractCount(data) {
  const candidates = [
    data?.subscriber_count,
    data?.publication?.subscriber_count,
    data?.publication?.reader_count,
    data?.publication?.free_subscriber_count,
    data?.reader_count,
    data?.free_subscriber_count,
    data?.stats?.subscriber_count,
  ];
  return candidates.find((v) => typeof v === 'number' && v > 0) ?? null;
}

function formatCount(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1_000)     return `${Math.round(n / 1_000)}K`;
  return String(n);
}

module.exports = async function handler(req, res) {
  setCors(res);
  if (!requirePost(req, res)) return;

  const { name, url } = req.body || {};
  if (!name || !url) return res.status(400).json({ error: 'Newsletter name and URL are required.' });

  const apiKey = getApiKey(res);
  if (!apiKey) return;

  const user = `Perform a deep analysis of the newsletter "${name}" at ${url}.
Search the web thoroughly for the most current information. Use multiple searches.

For contact information specifically, search:
1. The newsletter's own website: look for /about, /contact, /work-with-us, /advertise, /media-kit pages
2. The author's Twitter/X bio (often contains email or link)
3. Their LinkedIn profile bio
4. Search: "${name} pitch" and "${name} contact" and "${name} advertise"
5. Their Muck Rack profile at muckrack.com

Return ONLY a valid JSON object with exactly these fields — no markdown, no other text:
{
  "theme": "One sentence summary of the niche/theme",
  "reach": "Subscriber count estimate — use a number if known, otherwise '10k+', '50k+', 'Unknown', etc.",
  "engagement": "Low" | "Medium" | "High",
  "engagement_score": 1-10 number rating engagement quality,
  "email": "Direct email address for the author or newsletter. Only a real email address — if not found, write 'Not found'.",
  "pitch_page": "Full URL to their contact, pitch, or work-with-us page. If not found, write 'Not found'.",
  "advertise_page": "Full URL to their advertise, sponsor, or media kit page. If not found, write 'Not found'.",
  "twitter": "Twitter/X handle with @ symbol (e.g. @username). If not found, write 'Not found'.",
  "location": "Author city/state/country or timezone. If unknown, write 'Not found'.",
  "muckrack_url": "Full URL to author's Muck Rack profile, or 'Not found'",
  "pr_insights": "2-3 sentences: Does the author accept pitches? What topics do they cover? Any known pitch preferences?",
  "publishing_insights": "2-3 sentences: Do they offer sponsorships or ads? What is the brand/advertiser vibe?",
  "categories": ["category1", "category2", "category3"],
  "frequency": "e.g. Weekly, Daily, Bi-weekly, Monthly",
  "language": "Primary language of the newsletter"
}`;

  try {
    const [perplexityRes, substackCount] = await Promise.all([
      callPerplexity(apiKey, {
        system: 'You are a PR research expert analyzing newsletters. Search the web thoroughly — use multiple searches to find contact information. Return only valid JSON objects, nothing else.',
        user,
        maxTokens: 2000,
      }),
      fetchSubstackSubscribers(url),
    ]);

    if (!perplexityRes.ok) {
      const errText = await perplexityRes.text();
      console.error('Perplexity API error (analyze):', perplexityRes.status, errText);
      return res.status(502).json({ error: `Analysis service error (${perplexityRes.status}). Please try again.` });
    }

    const data = await perplexityRes.json();
    const content = data.choices?.[0]?.message?.content || data.output || '';

    if (!content) {
      console.error('No content in analysis response. Full response:', JSON.stringify(data).slice(0, 1000));
      return res.status(502).json({ error: 'Analysis returned no content. Please try again.' });
    }

    const analysis = extractJson(content, 'object');
    if (!analysis) {
      console.error('Could not parse analysis JSON:', content.slice(0, 500));
      return res.status(502).json({ error: 'Could not parse analysis results. Please try again.' });
    }

    const result = {
      theme:                analysis.theme                || 'Not available',
      reach:                String(analysis.reach         || 'Unknown'),
      reach_verified:       false,
      engagement:           analysis.engagement           || 'Unknown',
      engagement_score:     Number(analysis.engagement_score) || 0,
      email:                analysis.email                || 'Not found',
      pitch_page:           analysis.pitch_page           || 'Not found',
      advertise_page:       analysis.advertise_page       || 'Not found',
      twitter:              analysis.twitter              || 'Not found',
      location:             analysis.location             || 'Not found',
      muckrack_url:         analysis.muckrack_url         || 'Not found',
      pr_insights:          analysis.pr_insights          || 'Not available',
      publishing_insights:  analysis.publishing_insights  || 'Not available',
      categories:           Array.isArray(analysis.categories) ? analysis.categories : [],
      frequency:            analysis.frequency            || 'Unknown',
      language:             analysis.language             || 'English',
    };

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
