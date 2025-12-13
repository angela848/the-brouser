import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { Search, Users, MessageSquare, Newspaper, Zap, Loader2, Mail, FileDown, MapPin, Briefcase, Handshake, TrendingUp, Filter, Star, StarOff, BarChart3, X, ArrowUpDown, Clock, Save, Trash2, Copy, Check } from 'lucide-react';

// --- Configuration for Gemini API ---
const API_KEY = process.env.REACT_APP_GEMINI_API_KEY || "";
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${API_KEY}`;

// Brouhaha Brand Colors (from brand guidelines)
const BRAND_COLORS = {
  green: '#033D35',      // Dark green
  chartreuse: '#D6FF84', // Brand chartreuse (main accent)
  cream: '#FAF5EF',      // Neutral cream
  purple: '#EAD3FF',     // Light purple
  purpleDark: '#C1A6E2', // Dark purple
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
export default function App() {
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
  const [showComparison, setShowComparison] = useState(false);
  const [comparisonList, setComparisonList] = useState([]);
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

        {/* Search Section */}
        <div className="border bg-opacity-50 p-6 sm:p-8 mb-8 rounded-2xl backdrop-blur-sm shadow-2xl" style={{borderColor: `${BRAND_COLORS.chartreuse}30`, background: `${BRAND_COLORS.green}CC`}}>
          <h2 className="text-2xl font-black mb-5 text-white flex items-center tracking-wide" style={{fontFamily: 'system-ui, -apple-system, sans-serif'}}>
            <Search className="mr-3" style={{color: BRAND_COLORS.chartreuse}}/>
            DISCOVER NEWSLETTERS
          </h2>
          
          <div className="flex flex-col gap-4">
            <div className="flex flex-col sm:flex-row gap-4">
              <input 
                type="text" 
                value={theme} 
                onChange={(e) => setTheme(e.target.value)} 
                placeholder="Search by theme, newsletter name, or author..."
                className="flex-grow bg-black/60 border text-white px-4 py-3 placeholder-gray-500 focus:outline-none focus:ring-2 transition-all rounded-xl"
                style={{borderColor: '#444', focusRingColor: BRAND_COLORS.chartreuse}}
                onKeyPress={(e) => e.key === 'Enter' && handleDiscoverNewsletters()} 
              />
              <button 
                onClick={handleDiscoverNewsletters} 
                disabled={isLoading.discovery}
                className="font-black py-3 px-8 flex items-center justify-center transition-all disabled:opacity-50 disabled:cursor-not-allowed rounded-xl shadow-lg transform hover:scale-105"
                style={{background: BRAND_COLORS.chartreuse, color: BRAND_COLORS.green}}>
                {isLoading.discovery ? <Loader2 className="animate-spin mr-2"/> : <Zap className="mr-2"/>} 
                FIND NEWSLETTERS
              </button>
            </div>
            
            {searchHistory.length > 0 && !theme && (
              <div className="flex flex-wrap gap-2 items-center">
                <Clock className="w-4 h-4 text-gray-500" />
                <span className="text-sm text-gray-500">Recent:</span>
                {searchHistory.slice(0, 5).map((term, i) => (
                  <button
                    key={i}
                    onClick={() => setTheme(term)}
                    className="text-xs px-3 py-1 rounded-full transition-colors border"
                    style={{background: '#ffffff10', color: '#ccc', borderColor: '#ffffff20'}}
                  >
                    {term}
                  </button>
                ))}
              </div>
            )}
            
            <div className="flex flex-wrap gap-4 items-center">
              <label className="flex items-center space-x-3 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={excludeMedia}
                  onChange={() => setExcludeMedia(!excludeMedia)}
                  className="form-checkbox h-5 w-5 bg-black border-gray-700 rounded transition-colors"
                  style={{color: BRAND_COLORS.chartreuse}}
                />
                <span className="text-gray-300 group-hover:text-white transition-colors text-sm">Exclude major media outlets</span>
              </label>
              
              {favorites.length > 0 && (
                <button
                  onClick={() => setNewsletters(favorites)}
                  className="text-sm px-4 py-2 rounded-lg transition-colors border flex items-center gap-2"
                  style={{background: '#ffffff10', color: BRAND_COLORS.chartreuse, borderColor: `${BRAND_COLORS.chartreuse}30`}}
                >
                  <Star className="w-4 h-4" />
                  View Favorites ({favorites.length})
                </button>
              )}
              
              {stats && (
                <button
                  onClick={() => setShowStats(!showStats)}
                  className="text-sm px-4 py-2 rounded-lg transition-colors border flex items-center gap-2"
                  style={{background: '#ffffff10', color: BRAND_COLORS.chartreuse, borderColor: `${BRAND_COLORS.chartreuse}30`}}
                >
                  <BarChart3 className="w-4 h-4" />
                  {showStats ? 'Hide' : 'Show'} Stats
                </button>
              )}
            </div>
          </div>
          
          {error && (
            <div className="mt-4 p-4 bg-red-900/30 border border-red-500/50 rounded-xl text-red-200 flex items-start gap-3">
              <X className="w-5 h-5 flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}
        </div>

        {/* Stats Dashboard */}
        {showStats && stats && (
          <div className="border p-6 mb-8 rounded-2xl backdrop-blur-sm" style={{borderColor: `${BRAND_COLORS.chartreuse}30`, background: `${BRAND_COLORS.green}CC`}}>
            <h3 className="text-xl font-black mb-4 text-white flex items-center tracking-wide" style={{fontFamily: 'system-ui, -apple-system, sans-serif'}}>
              <BarChart3 className="mr-3" style={{color: BRAND_COLORS.chartreuse}}/>
              STATISTICS DASHBOARD
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-black/40 p-4 rounded-xl border border-gray-800">
                <p className="text-gray-400 text-sm mb-1">Total Found</p>
                <p className="text-3xl font-black" style={{color: BRAND_COLORS.chartreuse}}>{stats.total}</p>
              </div>
              <div className="bg-black/40 p-4 rounded-xl border border-gray-800">
                <p className="text-gray-400 text-sm mb-1">Analyzed</p>
                <p className="text-3xl font-black" style={{color: BRAND_COLORS.chartreuse}}>{stats.analyzed}</p>
              </div>
              <div className="bg-black/40 p-4 rounded-xl border border-gray-800">
                <p className="text-gray-400 text-sm mb-1">Avg Engagement Score</p>
                <p className="text-3xl font-black" style={{color: BRAND_COLORS.chartreuse}}>{stats.avgEngagement}/10</p>
              </div>
              <div className="bg-black/40 p-4 rounded-xl border border-gray-800">
                <p className="text-gray-400 text-sm mb-2">Engagement Distribution</p>
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-green-400">High:</span>
                    <span className="text-white font-semibold">{stats.distribution.high}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-yellow-400">Medium:</span>
                    <span className="text-white font-semibold">{stats.distribution.medium}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-red-400">Low:</span>
                    <span className="text-white font-semibold">{stats.distribution.low}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Main Content - TWO COLUMN LAYOUT (Analysis LEFT, Results RIGHT) */}
        <main className="grid lg:grid-cols-[400px,1fr] gap-8">
          
          {/* LEFT SIDE: AI Analysis Panel */}
          <div className="border p-6 sm:p-8 rounded-2xl shadow-2xl sticky top-6 h-fit" style={{borderColor: `${BRAND_COLORS.chartreuse}30`, background: `${BRAND_COLORS.green}F5`}}>
             <h3 className="text-xl font-black text-white mb-6 pb-4 border-b flex items-center tracking-wide" style={{borderColor: '#ffffff20', fontFamily: 'system-ui, -apple-system, sans-serif'}}>
               <Zap className="mr-3" style={{color: BRAND_COLORS.chartreuse}}/>
               AI ANALYSIS
             </h3>
             
             {isLoading.analysis && (
                 <div className="py-24 flex justify-center">
                    {renderLoadingIndicator("Deep-analyzing newsletter...")}
                 </div>
             )}
             
             {currentAnalysis ? (
               <div className="space-y-6">
                 <div>
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <h4 className="text-2xl font-black tracking-tight leading-tight" style={{color: BRAND_COLORS.chartreuse, fontFamily: 'system-ui, -apple-system, sans-serif'}}>
                        {currentAnalysis.name}
                      </h4>
                      <button
                        onClick={() => handleToggleFavorite(currentAnalysis)}
                        className="p-2 hover:bg-gray-800/50 rounded-lg transition-colors flex-shrink-0"
                      >
                        {favorites.some(f => f.url === currentAnalysis.url) ? (
                          <Star className="w-6 h-6" style={{color: BRAND_COLORS.chartreuse, fill: BRAND_COLORS.chartreuse}} />
                        ) : (
                          <StarOff className="w-6 h-6 text-gray-500" />
                        )}
                      </button>
                    </div>
                    <a 
                      href={currentAnalysis.url} 
                      target="_blank" 
                      rel="noopener noreferrer" 
                      className="text-sm hover:underline break-all block transition-colors"
                      style={{color: `${BRAND_COLORS.chartreuse}CC`}}
                    >
                      {currentAnalysis.url}
                    </a>
                    
                    {currentAnalysis.categories && (
                      <div className="flex flex-wrap gap-2 mt-3">
                        {currentAnalysis.categories.map((cat, i) => (
                          <span key={i} className="text-xs px-3 py-1 rounded-full border font-medium" style={{background: `${BRAND_COLORS.chartreuse}30`, color: BRAND_COLORS.chartreuse, borderColor: `${BRAND_COLORS.chartreuse}50`}}>
                            {cat}
                          </span>
                        ))}
                        {currentAnalysis.frequency && (
                          <span className="bg-gray-800/50 text-gray-300 text-xs px-3 py-1 rounded-full border border-gray-700">
                            📅 {currentAnalysis.frequency}
                          </span>
                        )}
                        {currentAnalysis.language && (
                          <span className="bg-gray-800/50 text-gray-300 text-xs px-3 py-1 rounded-full border border-gray-700">
                            🌐 {currentAnalysis.language}
                          </span>
                        )}
                      </div>
                    )}
                 </div>
                 
                 <div className="p-4 border rounded-xl" style={{background: `${BRAND_COLORS.chartreuse}15`, borderColor: `${BRAND_COLORS.chartreuse}30`}}>
                   <p className="font-bold mb-2 text-sm uppercase tracking-wider flex items-center" style={{color: BRAND_COLORS.chartreuse}}>
                     <MessageSquare className="w-4 h-4 mr-2" />
                     Theme
                   </p>
                   <p className="text-gray-200 font-light leading-relaxed text-sm">{currentAnalysis.theme}</p>
                 </div>
 
                 <div className="grid grid-cols-2 gap-4">
                     <div className="bg-gray-800/60 p-4 rounded-xl border border-gray-700/50">
                         <p className="text-xs text-gray-400 mb-1 flex items-center uppercase tracking-widest">
                           <Users className="w-3 h-3 mr-2"/>
                           Reach
                         </p>
                         <p className="font-bold text-xl text-white">{currentAnalysis.reach}</p>
                     </div>
                     <div className="bg-gray-800/60 p-4 rounded-xl border border-gray-700/50">
                         <p className="text-xs text-gray-400 mb-1 flex items-center uppercase tracking-widest">
                           <MessageSquare className="w-3 h-3 mr-2"/>
                           Engagement
                         </p>
                         <p className="font-bold text-xl text-white">
                           {currentAnalysis.engagement}
                           <span className="text-sm text-gray-400 ml-2">
                             ({currentAnalysis.engagement_score}/10)
                           </span>
                         </p>
                     </div>
                 </div>
 
                  <div className="border-t pt-4" style={{borderColor: '#ffffff20'}}>
                     <p className="font-bold text-white mb-2 flex items-center text-sm uppercase tracking-wide text-gray-400">
                       <MapPin className="w-4 h-4 mr-2" style={{color: BRAND_COLORS.chartreuse}}/>
                       Location
                     </p>
                     <p className="text-gray-300 font-light pl-6 text-sm">{currentAnalysis.location}</p>
                 </div>
 
                 <div className="border-t pt-4" style={{borderColor: '#ffffff20'}}>
                     <p className="font-bold text-white mb-2 flex items-center text-sm uppercase tracking-wide text-gray-400">
                       <Mail className="w-4 h-4 mr-2" style={{color: BRAND_COLORS.chartreuse}}/>
                       Contact
                     </p>
                     <div className="pl-6">
                        {currentAnalysis.contact && currentAnalysis.contact.includes('@') ? (
                            <a href={`mailto:${currentAnalysis.contact}`} className="hover:underline break-all font-light text-sm" style={{color: BRAND_COLORS.chartreuse}}>
                              {currentAnalysis.contact}
                            </a>
                        ) : currentAnalysis.contact && currentAnalysis.contact.startsWith('http') ? (
                            <a href={currentAnalysis.contact} target="_blank" rel="noopener noreferrer" className="hover:underline break-all font-light text-sm" style={{color: BRAND_COLORS.chartreuse}}>
                              Contact Form / Page
                            </a>
                        ) : (
                            <p className="text-gray-300 font-light text-sm">{currentAnalysis.contact}</p>
                        )}
                     </div>
                 </div>
 
                 <div className="border-t pt-4" style={{borderColor: '#ffffff20'}}>
                     <div className="flex justify-between items-center mb-2">
                        <p className="font-bold text-white flex items-center text-sm uppercase tracking-wide text-gray-400">
                          <Briefcase className="w-4 h-4 mr-2" style={{color: BRAND_COLORS.chartreuse}}/>
                          PR Insights
                        </p>
                        {currentAnalysis.muckrack_url && currentAnalysis.muckrack_url !== 'Not found' && (
                            <a 
                              href={currentAnalysis.muckrack_url} 
                              target="_blank" 
                              rel="noopener noreferrer" 
                              className="text-xs px-3 py-1.5 rounded-lg transition-colors border"
                              style={{background: '#ffffff10', color: BRAND_COLORS.chartreuse, borderColor: `${BRAND_COLORS.chartreuse}30`}}
                            >
                              Muck Rack
                            </a>
                        )}
                     </div>
                     <p className="text-gray-300 font-light pl-6 leading-relaxed text-sm">{currentAnalysis.pr_insights}</p>
                 </div>
 
                 <div className="border-t pt-4" style={{borderColor: '#ffffff20'}}>
                     <p className="font-bold text-white mb-2 flex items-center text-sm uppercase tracking-wide text-gray-400">
                       <Handshake className="w-4 h-4 mr-2" style={{color: BRAND_COLORS.chartreuse}}/>
                       Publishing Insight
                     </p>
                     <p className="text-gray-300 font-light pl-6 leading-relaxed text-sm">{currentAnalysis.publishing_insights}</p>
                 </div>
                 
                 <div className="pt-4 flex flex-wrap gap-2" style={{borderTop: `1px solid #ffffff20`}}>
                   <button
                     onClick={() => handleCopyUrl(currentAnalysis.url)}
                     className="flex-1 text-white text-sm px-4 py-2 rounded-lg transition-colors flex items-center justify-center gap-2 border"
                     style={{background: '#ffffff10', borderColor: '#ffffff20'}}
                   >
                     {copiedUrl === currentAnalysis.url ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                     {copiedUrl === currentAnalysis.url ? 'Copied!' : 'Copy URL'}
                   </button>
                 </div>
               </div>
             ) : !isLoading.analysis && (
               <div className="text-center py-24 flex flex-col items-center opacity-50">
                 <Zap className="w-16 h-16 text-gray-700 mb-4" />
                 <p className="text-gray-500 text-lg">Select a newsletter to analyze.</p>
                 <p className="text-gray-600 text-sm mt-2">Click any newsletter from the list</p>
               </div>
             )}
          </div>

          {/* RIGHT SIDE: Discovery Results */}
          <div className="border p-6 sm:p-8 rounded-2xl shadow-2xl" style={{borderColor: `${BRAND_COLORS.chartreuse}30`, background: `${BRAND_COLORS.green}F5`}}>
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6 pb-4 border-b" style={{borderColor: '#ffffff20'}}>
                <div className="flex items-center gap-3">
                  <h3 className="text-xl font-black text-white flex items-center tracking-wide" style={{fontFamily: 'system-ui, -apple-system, sans-serif'}}>
                    <Newspaper className="mr-3" style={{color: BRAND_COLORS.chartreuse}}/>
                    RESULTS
                    {sortedAndFilteredNewsletters.length > 0 && (
                      <span className="ml-3 text-sm text-gray-400">({sortedAndFilteredNewsletters.length})</span>
                    )}
                  </h3>
                  {(filterEngagement !== 'all' || filterLocation || filterLanguage !== 'all') && (
                    <button
                      onClick={() => {
                        setFilterEngagement('all');
                        setFilterLocation('');
                        setFilterLanguage('all');
                      }}
                      className="text-xs px-3 py-1 rounded-full transition-colors border flex items-center gap-1"
                      style={{background: '#ff000020', color: '#ff6b6b', borderColor: '#ff000030'}}
                    >
                      <X className="w-3 h-3" />
                      Clear
                    </button>
                  )}
                </div>
                
                {/* Filters & Export */}
                <div className="flex flex-wrap gap-2">
                    <select
                        value={sortBy}
                        onChange={(e) => setSortBy(e.target.value)}
                        className="bg-gray-800 border border-gray-700 text-gray-300 text-sm px-3 py-2 rounded-lg focus:outline-none appearance-none"
                      >
                        <option value="relevance">Sort: Relevance</option>
                        <option value="name">Sort: Name</option>
                        <option value="engagement">Sort: Engagement</option>
                        <option value="reach">Sort: Reach</option>
                      </select>
                    
                    <select
                        value={filterEngagement}
                        onChange={(e) => setFilterEngagement(e.target.value)}
                        className="bg-gray-800 border border-gray-700 text-gray-300 text-sm px-3 py-2 rounded-lg focus:outline-none appearance-none"
                      >
                        <option value="all">All Engagement</option>
                        <option value="high">High Only</option>
                        <option value="medium">Medium Only</option>
                        <option value="low">Low Only</option>
                      </select>
                    
                    <input
                      type="text"
                      value={filterLocation}
                      onChange={(e) => setFilterLocation(e.target.value)}
                      placeholder="Location..."
                      className="bg-gray-800 border border-gray-700 text-gray-300 text-sm px-3 py-2 rounded-lg focus:outline-none placeholder-gray-500 w-32"
                    />
                    
                    <select
                        value={filterLanguage}
                        onChange={(e) => setFilterLanguage(e.target.value)}
                        className="bg-gray-800 border border-gray-700 text-gray-300 text-sm px-3 py-2 rounded-lg focus:outline-none appearance-none"
                      >
                        <option value="all">All Languages</option>
                        <option value="english">English</option>
                        <option value="spanish">Spanish</option>
                        <option value="french">French</option>
                        <option value="other">Other</option>
                      </select>
                    
                    {selectedCount > 0 && (
                        <button 
                          onClick={handleExport} 
                          disabled={isLoading.export} 
                          className="font-semibold py-2 px-4 flex items-center transition-colors text-sm disabled:opacity-50 rounded-lg border"
                          style={{background: `${BRAND_COLORS.chartreuse}30`, color: BRAND_COLORS.chartreuse, borderColor: `${BRAND_COLORS.chartreuse}50`}}
                        >
                            {isLoading.export ? <Loader2 className="animate-spin mr-2 w-4 h-4"/> : <FileDown className="w-4 h-4 mr-2"/>}
                            Export ({Math.min(selectedCount, 25)})
                        </button>
                    )}
                </div>
            </div>
            
            {isLoading.discovery && (
                <div className="py-16 flex justify-center bg-black/20 rounded-xl border border-gray-800/50">
                    {renderLoadingIndicator("Searching the web for newsletters...")}
                </div>
            )}
            
            {isLoading.export && (
                 <div className="py-8 bg-black/20 rounded-xl border border-gray-800/50 mb-4 px-4">
                    <div className="flex justify-between text-xs mb-2 font-mono" style={{color: BRAND_COLORS.chartreuse}}>
                        <span>ANALYZING NEWSLETTERS...</span>
                        <span>{exportProgress.current} / {exportProgress.total}</span>
                    </div>
                    <div className="w-full bg-gray-800 rounded-full h-2.5 overflow-hidden">
                        <div 
                            className="h-2.5 transition-all duration-300 ease-out"
                            style={{ 
                              width: `${(exportProgress.current / Math.max(exportProgress.total, 1)) * 100}%`,
                              background: BRAND_COLORS.chartreuse,
                              boxShadow: `0 0 15px ${BRAND_COLORS.chartreuse}99`
                            }}
                        ></div>
                    </div>
                    <p className="text-center text-xs text-gray-400 mt-2">Processing in optimized batches...</p>
                 </div>
            )}

            {sortedAndFilteredNewsletters.length > 0 && !isLoading.discovery && (
              <ul className="space-y-3 max-h-[900px] overflow-y-auto pr-2 custom-scrollbar">
                {sortedAndFilteredNewsletters.map((newsletter) => {
                  const isFavorite = favorites.some(f => f.url === newsletter.url);
                  const cached = getCachedData(`analysis_${newsletter.url}`);
                  
                  return (
                    <li key={newsletter.url} className="flex items-start gap-3 p-4 bg-black/40 border hover:border-opacity-100 transition-all rounded-xl group" style={{borderColor: '#ffffff20'}}>
                      <div className="flex items-center h-full pt-1.5">
                          <input 
                            type="checkbox" 
                            checked={!!selectedNewsletters[newsletter.url]} 
                            onChange={() => handleToggleSelection(newsletter.url)}
                            className="form-checkbox h-5 w-5 bg-black border-gray-600 cursor-pointer rounded transition-colors"
                            style={{color: BRAND_COLORS.chartreuse}}
                          />
                      </div>
                      
                      <div className="flex-grow min-w-0">
                        <div className="flex items-start justify-between gap-2 mb-1">
                          <button 
                            onClick={() => handleAnalyzeNewsletter(newsletter)} 
                            disabled={isLoading.analysis}
                            className="flex-grow text-left focus:outline-none disabled:opacity-50 disabled:cursor-wait group/btn"
                          >
                            <p className="font-bold text-white group-hover/btn:opacity-80 transition-colors leading-tight" style={{fontFamily: 'system-ui, -apple-system, sans-serif'}}>
                              {newsletter.name}
                            </p>
                          </button>
                          
                          <div className="flex gap-1 flex-shrink-0">
                            <button
                              onClick={() => handleToggleFavorite(newsletter)}
                              className="p-1.5 hover:bg-gray-700/50 rounded-lg transition-colors"
                            >
                              {isFavorite ? (
                                <Star className="w-4 h-4" style={{color: BRAND_COLORS.chartreuse, fill: BRAND_COLORS.chartreuse}} />
                              ) : (
                                <StarOff className="w-4 h-4 text-gray-500 group-hover:text-gray-300" />
                              )}
                            </button>
                            
                            <button
                              onClick={() => handleCopyUrl(newsletter.url)}
                              className="p-1.5 hover:bg-gray-700/50 rounded-lg transition-colors"
                            >
                              {copiedUrl === newsletter.url ? (
                                <Check className="w-4 h-4" style={{color: BRAND_COLORS.chartreuse}} />
                              ) : (
                                <Copy className="w-4 h-4 text-gray-500 group-hover:text-gray-300" />
                              )}
                            </button>
                          </div>
                        </div>
                        
                        <p className="text-xs text-gray-500 truncate mb-2">{newsletter.url}</p>
                        
                        {cached && (
                          <div className="flex flex-wrap gap-2 text-xs">
                            {cached.categories?.map((cat, i) => (
                              <span key={i} className="px-2 py-0.5 rounded-full border" style={{background: `${BRAND_COLORS.chartreuse}30`, color: BRAND_COLORS.chartreuse, borderColor: `${BRAND_COLORS.chartreuse}50`}}>
                                {cat}
                              </span>
                            ))}
                            <span className="bg-gray-800/50 text-gray-400 px-2 py-0.5 rounded-full">
                              {cached.engagement}
                            </span>
                            <span className="bg-gray-800/50 text-gray-400 px-2 py-0.5 rounded-full">
                              {cached.frequency}
                            </span>
                          </div>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            
            {!isLoading.discovery && sortedAndFilteredNewsletters.length === 0 && newsletters.length === 0 && (
                <div className="text-center py-24 border border-dashed border-gray-800 rounded-xl opacity-50">
                    <Search className="w-16 h-16 mx-auto text-gray-700 mb-4"/>
                    <p className="text-gray-500 text-lg">Enter a search term to discover newsletters.</p>
                    <p className="text-gray-600 text-sm mt-2">Try searching for "travel", "tech", or "finance"</p>
                </div>
            )}
            
            {!isLoading.discovery && sortedAndFilteredNewsletters.length === 0 && newsletters.length > 0 && (
                <div className="text-center py-24 border border-dashed border-gray-800 rounded-xl opacity-50">
                    <Filter className="w-16 h-16 mx-auto text-gray-700 mb-4"/>
                    <p className="text-gray-500 text-lg">No newsletters match your filters.</p>
                    <button
                      onClick={() => {
                        setFilterEngagement('all');
                        setFilterLocation('');
                        setFilterLanguage('all');
                      }}
                      className="mt-4 text-sm hover:underline"
                      style={{color: BRAND_COLORS.chartreuse}}
                    >
                      Clear all filters
                    </button>
                </div>
            )}
          </div>
        </main>
        
        {/* Footer Tip */}
        <div className="mt-8 text-center text-xs text-gray-600">
          <p>
            💡 <span className="text-gray-500">Tip:</span> Use checkboxes to multi-select newsletters for batch export
          </p>
        </div>
      </div>
      
      {/* Custom Scrollbar */}
      <style jsx>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 8px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: rgba(0, 0, 0, 0.2);
          border-radius: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: ${BRAND_COLORS.chartreuse}50;
          border-radius: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: ${BRAND_COLORS.chartreuse}80;
        }
      `}</style>
    </div>
  );
}
