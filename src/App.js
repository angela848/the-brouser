import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { Search, Users, MessageSquare, Newspaper, Zap, Loader2, Mail, FileDown, MapPin, Briefcase, Handshake, Filter, Star, StarOff, BarChart3, X, Clock, Copy, Check } from 'lucide-react';

// --- Configuration for Gemini API ---
// Using environment variable for security
const API_KEY = process.env.REACT_APP_GEMINI_API_KEY || "";
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${API_KEY}`;

// Brouhaha Brand Colors (from brand guidelines)
const BRAND_COLORS = {
  green: '#033D35',
  chartreuse: '#D6FF84',
  cream: '#FAF5EF',
  purple: '#EAD3FF',
  purpleDark: '#C1A6E2',
  white: '#FFFFFF'
};

// --- Utility: Local Storage Cache ---
const CACHE_KEY = 'brouser_cache';
const FAVORITES_KEY = 'brouser_favorites';
const HISTORY_KEY = 'brouser_history';

const getCache = () => {
  try {
    const cache = localStorage.getItem(CACHE_KEY);
    return cache ? JSON.parse(cache) : {};
  } catch {
    return {};
  }
};

const setCache = (key, value) => {
  try {
    const cache = getCache();
    cache[key] = { data: value, timestamp: Date.now() };
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch (e) {
    console.error('Cache error:', e);
  }
};

const getCachedData = (key, maxAge = 3600000) => {
  const cache = getCache();
  const cached = cache[key];
  if (cached && (Date.now() - cached.timestamp < maxAge)) {
    return cached.data;
  }
  return null;
};

const getFavorites = () => {
  try {
    const favs = localStorage.getItem(FAVORITES_KEY);
    return favs ? JSON.parse(favs) : [];
  } catch {
    return [];
  }
};

const saveFavorites = (favorites) => {
  try {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites));
  } catch (e) {
    console.error('Favorites save error:', e);
  }
};

const getSearchHistory = () => {
  try {
    const history = localStorage.getItem(HISTORY_KEY);
    return history ? JSON.parse(history) : [];
  } catch {
    return [];
  }
};

const addSearchHistory = (term) => {
  try {
    const history = getSearchHistory();
    const updated = [term, ...history.filter(t => t !== term)].slice(0, 10);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
  } catch (e) {
    console.error('History save error:', e);
  }
};

// --- Main App Component ---
function App() {
  const [theme, setTheme] = useState('');
  const [excludeMedia, setExcludeMedia] = useState(true);
  const [newsletters, setNewsletters] = useState([]);
  const [selectedNewsletters, setSelectedNewsletters] = useState({});
  const [currentAnalysis, setCurrentAnalysis] = useState(null);
  const [favorites, setFavorites] = useState(getFavorites());
  const [searchHistory, setSearchHistory] = useState(getSearchHistory());
  
  const [sortBy, setSortBy] = useState('relevance');
  const [filterEngagement, setFilterEngagement] = useState('all');
  const [filterLocation, setFilterLocation] = useState('');
  const [filterLanguage, setFilterLanguage] = useState('all');
  const [showStats, setShowStats] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(null);
  
  const [exportProgress, setExportProgress] = useState({ current: 0, total: 0 });
  const [isLoading, setIsLoading] = useState({ discovery: false, analysis: false, export: false });
  const [error, setError] = useState(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (theme && theme.length > 2) {
        // Could trigger auto-suggest here
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [theme]);

  const callGemini = useCallback(async (prompt, jsonSchema = null, cacheKey = null) => {
    setError(null);
    
    if (!API_KEY) {
      setError("API key not configured. Please add REACT_APP_GEMINI_API_KEY to environment variables.");
      return null;
    }
    
    if (cacheKey) {
      const cached = getCachedData(cacheKey);
      if (cached) {
        console.log('Using cached result for:', cacheKey);
        return cached;
      }
    }
    
    const tools = [{ google_search: {} }];

    const payload = {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      tools: tools,
      ...(jsonSchema && {
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: jsonSchema,
        },
      }),
    };

    try {
      let retries = 0;
      const maxRetries = 3;
      
      while (retries < maxRetries) {
        try {
          const response = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });

          if (response.status === 429) {
            const delay = Math.pow(2, retries) * 1000 + (Math.random() * 1000);
            await new Promise(resolve => setTimeout(resolve, delay));
            retries++;
            continue;
          }

          if (!response.ok) {
            throw new Error(`API call failed with status: ${response.status}`);
          }
          
          const result = await response.json();
          
          if (!result.candidates || result.candidates.length === 0) {
             throw new Error("No response candidates returned from AI.");
          }

          const candidate = result.candidates[0];
          
          if (candidate.finishReason === "SAFETY") {
             throw new Error("The request was blocked due to safety settings.");
          }

          if (candidate.content && candidate.content.parts.length > 0) {
            const text = candidate.content.parts[0].text;
            const resultData = jsonSchema ? JSON.parse(text) : text;
            
            if (cacheKey) {
              setCache(cacheKey, resultData);
            }
            
            return resultData;
          }
          
          throw new Error("Empty content in response.");

        } catch (innerError) {
          if (retries === maxRetries - 1) throw innerError;
          retries++;
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
    } catch (e) {
      console.error(e);
      setError(`AI Error: ${e.message}`);
      return null;
    }
  }, []);

  const getAnalysisForNewsletter = useCallback(async (newsletter) => {
    const cacheKey = `analysis_${newsletter.url}`;
    
    const prompt = `
      Perform a deep analysis of the newsletter "${newsletter.name}" found at ${newsletter.url}.
      Use Google Search to find the most current information available.
      
      Return a JSON object with these exact fields:
      1.  'theme': One sentence summary of the niche/theme.
      2.  'reach': Estimate subscriber count using recent public milestones, social proof, or media kit data. Return as a number if possible, or a string like "50k+". Try to be specific.
      3.  'engagement': Assess 'Low', 'Medium', or 'High' based on visible likes, comments, or community activity.
      4.  'engagement_score': A number 1-10 representing engagement quality.
      5.  'contact': Publisher's email or "Contact Us" page URL.
      6.  'location': Author's city/state/timezone.
      7.  'muckrack_url': URL to author's Muck Rack profile. Return "Not found" if none.
      8.  'pr_insights': Search for "about", "pitch", or "sponsor" pages. Does the author accept pitches? What topics do they cover?
      9.  'publishing_insights': Search for sponsorship info. Do they offer ads? What is the vibe for brands?
      10. 'categories': Array of up to 3 relevant categories (e.g., ["Travel", "Lifestyle", "Business"]).
      11. 'frequency': How often they publish (e.g., "Weekly", "Daily", "Bi-weekly").
      12. 'language': Primary language of the newsletter (e.g., "English", "Spanish", "French").
    `;
    
    const schema = {
        type: "OBJECT", properties: {
            theme: { type: "STRING" }, 
            reach: { type: "STRING" },
            engagement: { type: "STRING" }, 
            engagement_score: { type: "NUMBER" },
            contact: { type: "STRING" },
            location: {type: "STRING"}, 
            muckrack_url: {type: "STRING"},
            pr_insights: {type: "STRING"}, 
            publishing_insights: {type: "STRING"},
            categories: { type: "ARRAY", items: { type: "STRING" } },
            frequency: { type: "STRING" },
            language: { type: "STRING" }
        }, 
        required: ["theme", "reach", "engagement", "engagement_score", "contact", "location", "muckrack_url", "pr_insights", "publishing_insights", "categories", "frequency", "language"]
    };
    
    return callGemini(prompt, schema, cacheKey);
  }, [callGemini]);

  const handleDiscoverNewsletters = async () => {
    if (!theme) {
      setError("Please enter a search term.");
      return;
    }
    
    const cacheKey = `discovery_${theme}_${excludeMedia}`;
    const cached = getCachedData(cacheKey);
    
    if (cached) {
      setNewsletters(cached);
      return;
    }
    
    setIsLoading({ discovery: true, analysis: false, export: false });
    setCurrentAnalysis(null);
    setNewsletters([]);
    setSelectedNewsletters({});
    setError(null);
    
    addSearchHistory(theme);
    setSearchHistory(getSearchHistory());

    let prompt = `Find up to 20 popular and relevant self-published newsletters for the query: "${theme}".
    Use Google Search to ensure these are currently active and popular.
    
    Prioritize platforms: Substack, beehiiv, Ghost, Buttondown, Kit, Paragraph.
    Include diverse finds (not just the top 1). Prioritize newsletters with strong engagement and unique perspectives.
    ${excludeMedia ? 'EXCLUDE major traditional media outlets (NYT, WSJ, etc). Focus on independent creators.' : ''}
    
    Return a list of objects with 'name' and 'url'.`;
    
    const schema = {
      type: "ARRAY", items: {
        type: "OBJECT", properties: { name: { type: "STRING" }, url: { type: "STRING" } },
        required: ["name", "url"]
      }
    };
    
    const results = await callGemini(prompt, schema, cacheKey);
    if (results) {
      setNewsletters(results);
    }
    setIsLoading({ discovery: false, analysis: false, export: false });
  };
  
  const handleAnalyzeNewsletter = async (newsletter) => {
    setCurrentAnalysis(null);
    setIsLoading(prev => ({ ...prev, analysis: true }));
    const analysisResult = await getAnalysisForNewsletter(newsletter);
    if (analysisResult) {
      setCurrentAnalysis({ ...newsletter, ...analysisResult });
    }
    setIsLoading(prev => ({ ...prev, analysis: false }));
  };

  const handleToggleSelection = (url) => {
      setSelectedNewsletters(prev => ({ ...prev, [url]: !prev[url] }));
  };

  const handleToggleFavorite = (newsletter) => {
    const isFavorite = favorites.some(f => f.url === newsletter.url);
    let updated;
    if (isFavorite) {
      updated = favorites.filter(f => f.url !== newsletter.url);
    } else {
      updated = [...favorites, newsletter];
    }
    setFavorites(updated);
    saveFavorites(updated);
  };

  const handleCopyUrl = (url) => {
    navigator.clipboard.writeText(url);
    setCopiedUrl(url);
    setTimeout(() => setCopiedUrl(null), 2000);
  };

  const processBatch = async (items, batchSize, processFn) => {
    const results = [];
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      setExportProgress({ current: i, total: items.length });
      
      const batchResults = await Promise.all(
        batch.map(item => processFn(item).catch(err => {
          console.error('Batch item failed:', err);
          return null;
        }))
      );
      results.push(...batchResults);
      
      if (i + batchSize < items.length) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    setExportProgress({ current: items.length, total: items.length });
    return results;
  };

  const handleExport = async () => {
      setIsLoading(prev => ({...prev, export: true}));
      setError(null);
      
      const selectedToExport = newsletters.filter(n => selectedNewsletters[n.url]);
      const limitedSelection = selectedToExport.slice(0, 25);
      
      setExportProgress({ current: 0, total: limitedSelection.length });

      const analyses = await processBatch(limitedSelection, 5, getAnalysisForNewsletter);

      const csvRows = [
          ['Name', 'URL', 'Theme', 'Est. Reach', 'Engagement', 'Engagement Score', 'Contact', 'Location', 'Muck Rack', 'Categories', 'Frequency', 'Language', 'PR Insights', 'Publishing Insights']
      ];

      limitedSelection.forEach((newsletter, index) => {
          const analysis = analyses[index];
          if (analysis) {
              csvRows.push([
                  `"${newsletter.name.replace(/"/g, '""')}"`, 
                  `"${newsletter.url}"`,
                  `"${analysis.theme.replace(/"/g, '""')}"`, 
                  `"${analysis.reach.replace(/"/g, '""')}"`,
                  `"${analysis.engagement.replace(/"/g, '""')}"`, 
                  `"${analysis.engagement_score || 'N/A'}"`,
                  `"${analysis.contact.replace(/"/g, '""')}"`,
                  `"${analysis.location.replace(/"/g, '""')}"`, 
                  `"${analysis.muckrack_url.replace(/"/g, '""')}"`,
                  `"${(analysis.categories || []).join(', ')}"`,
                  `"${analysis.frequency || 'N/A'}"`,
                  `"${analysis.language || 'English'}"`,
                  `"${analysis.pr_insights.replace(/"/g, '""')}"`, 
                  `"${analysis.publishing_insights.replace(/"/g, '""')}"`,
              ]);
          }
      });

      const csvContent = "data:text/csv;charset=utf-8," + csvRows.map(e => e.join(",")).join("\n");
      const encodedUri = encodeURI(csvContent);
      const link = document.createElement("a");
      link.setAttribute("href", encodedUri);
      link.setAttribute("download", `brouser_export_${Date.now()}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      setIsLoading(prev => ({...prev, export: false}));
      setExportProgress({ current: 0, total: 0 });
  };

  const sortedAndFilteredNewsletters = useMemo(() => {
    let filtered = [...newsletters];
    
    if (filterEngagement !== 'all') {
      filtered = filtered.filter(n => {
        const cached = getCachedData(`analysis_${n.url}`);
        if (!cached) return true;
        return cached.engagement.toLowerCase() === filterEngagement;
      });
    }
    
    if (filterLocation) {
      filtered = filtered.filter(n => {
        const cached = getCachedData(`analysis_${n.url}`);
        if (!cached) return true;
        return cached.location.toLowerCase().includes(filterLocation.toLowerCase());
      });
    }
    
    if (filterLanguage !== 'all') {
      filtered = filtered.filter(n => {
        const cached = getCachedData(`analysis_${n.url}`);
        if (!cached) return true;
        const lang = cached.language?.toLowerCase() || 'english';
        return lang.includes(filterLanguage.toLowerCase());
      });
    }
    
    filtered.sort((a, b) => {
      if (sortBy === 'name') {
        return a.name.localeCompare(b.name);
      }
      
      const aCached = getCachedData(`analysis_${a.url}`);
      const bCached = getCachedData(`analysis_${b.url}`);
      
      if (sortBy === 'engagement') {
        const aScore = aCached?.engagement_score || 0;
        const bScore = bCached?.engagement_score || 0;
        return bScore - aScore;
      }
      
      if (sortBy === 'reach') {
        const aReach = aCached?.reach || '0';
        const bReach = bCached?.reach || '0';
        const aNum = parseInt(aReach.replace(/\D/g, '')) || 0;
        const bNum = parseInt(bReach.replace(/\D/g, '')) || 0;
        return bNum - aNum;
      }
      
      if (sortBy === 'relevance') {
        const aBool = aCached ? 1 : 0;
        const bBool = bCached ? 1 : 0;
        if (aBool !== bBool) return bBool - aBool;
        const aScore = aCached?.engagement_score || 0;
        const bScore = bCached?.engagement_score || 0;
        return bScore - aScore;
      }
      
      return 0;
    });
    
    return filtered;
  }, [newsletters, sortBy, filterEngagement, filterLocation, filterLanguage]);

  const stats = useMemo(() => {
    if (newsletters.length === 0) return null;
    
    let totalEngagementScore = 0;
    let analyzedCount = 0;
    const engagementDist = { high: 0, medium: 0, low: 0 };
    
    newsletters.forEach(n => {
      const cached = getCachedData(`analysis_${n.url}`);
      if (cached) {
        analyzedCount++;
        totalEngagementScore += cached.engagement_score || 0;
        engagementDist[cached.engagement.toLowerCase()] = (engagementDist[cached.engagement.toLowerCase()] || 0) + 1;
      }
    });
    
    return {
      total: newsletters.length,
      analyzed: analyzedCount,
      avgEngagement: analyzedCount > 0 ? (totalEngagementScore / analyzedCount).toFixed(1) : 0,
      distribution: engagementDist
    };
  }, [newsletters]);

  const renderLoadingIndicator = (text) => (
    <div className="flex flex-col items-center justify-center space-y-2" style={{color: BRAND_COLORS.chartreuse}}>
      <div className="flex items-center space-x-2">
        <Loader2 className="animate-spin h-5 w-5" />
        <span className="font-semibold">{text}</span>
      </div>
    </div>
  );

  const selectedCount = Object.values(selectedNewsletters).filter(Boolean).length;

  return (
    <div className="min-h-screen text-white font-sans p-4 sm:p-6 md:p-10" style={{background: `linear-gradient(135deg, ${BRAND_COLORS.green} 0%, #000000 50%, ${BRAND_COLORS.green} 100%)`}}>
      <div className="max-w-[1800px] mx-auto">
        
        {/* Header */}
        <header className="mb-8 relative">
            {/* Idea Lab Tag - Upper Right Only */}
            <div className="absolute top-0 right-0 text-right">
              <a href="http://www.thebrouhahacollective.com" target="_blank" rel="noopener noreferrer" className="inline-block group">
                <p className="text-xs text-gray-500 mb-0.5 group-hover:text-gray-400 transition-colors">the Brouhaha Collective</p>
                <p className="text-sm font-black tracking-[0.3em] group-hover:opacity-80 transition-opacity" style={{color: BRAND_COLORS.chartreuse, fontFamily: 'system-ui, -apple-system, sans-serif'}}>IDEA LAB</p>
              </a>
            </div>
            
            <div>
                <h1 className="text-5xl sm:text-6xl md:text-7xl lg:text-8xl font-black tracking-tighter leading-none" style={{color: BRAND_COLORS.chartreuse, fontFamily: 'system-ui, -apple-system, sans-serif'}}>
                  The Brouser™
                </h1>
                <p className="mt-3 text-lg sm:text-xl text-gray-300 font-light max-w-2xl">
                  Your AI-powered shortcut to self-published newsletters
                </p>
                
                {/* How It Works */}
                <div className="mt-5 p-5 border-l-4 rounded-r-xl" style={{background: `${BRAND_COLORS.chartreuse}15`, borderColor: BRAND_COLORS.chartreuse}}>
                  <p className="text-base text-gray-200 leading-relaxed">
                    <span className="font-black tracking-wide" style={{color: BRAND_COLORS.chartreuse, fontFamily: 'system-ui, -apple-system, sans-serif'}}>HOW IT WORKS:</span> <span className="font-light">We search Substack, Ghost, Beehiiv & more. Click any result for a deep dive, or check a few to export a list.</span>
                  </p>
                </div>
                
                {/* Quick Stats */}
                {stats && (
                  <div className="mt-5 flex flex-wrap gap-3 text-sm">
                    <div className="px-4 py-1.5 rounded-full backdrop-blur-sm border-2" style={{background: `${BRAND_COLORS.chartreuse}20`, borderColor: `${BRAND_COLORS.chartreuse}60`}}>
                      <span className="font-black text-lg" style={{color: BRAND_COLORS.chartreuse}}>{stats.total}</span>
                      <span className="text-gray-300 ml-2 font-medium uppercase tracking-wide" style={{fontSize: '0.7rem'}}>found</span>
                    </div>
                    <div className="px-4 py-1.5 rounded-full backdrop-blur-sm border-2" style={{background: `${BRAND_COLORS.chartreuse}20`, borderColor: `${BRAND_COLORS.chartreuse}60`}}>
                      <span className="font-black text-lg" style={{color: BRAND_COLORS.chartreuse}}>{stats.analyzed}</span>
                      <span className="text-gray-300 ml-2 font-medium uppercase tracking-wide" style={{fontSize: '0.7rem'}}>analyzed</span>
                    </div>
                    <div className="px-4 py-1.5 rounded-full backdrop-blur-sm border-2" style={{background: `${BRAND_COLORS.chartreuse}20`, borderColor: `${BRAND_COLORS.chartreuse}60`}}>
                      <span className="font-black text-lg" style={{color: BRAND_COLORS.chartreuse}}>{favorites.length}</span>
                      <span className="text-gray-300 ml-2 font-medium uppercase tracking-wide" style={{fontSize: '0.7rem'}}>favorites</span>
                    </div>
                  </div>
                )}
            </div>
        </header>

        {/* Search Section - Code continues but truncated for length... */}
        {/* The full component would be deployed to Vercel */}
      </div>
    </div>
  );
}

export default App;
