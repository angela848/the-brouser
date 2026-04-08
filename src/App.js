import React, { useState, useCallback, useMemo, useEffect } from 'react';
import {
  Search, Users, MessageSquare, Newspaper, Zap, Loader2, Mail,
  FileDown, MapPin, Briefcase, DollarSign, Filter, Star, StarOff,
  BarChart3, X, Clock, Copy, Check,
} from 'lucide-react';

// ─── Brand Colors ─────────────────────────────────────────────────────────────
const C = {
  green: '#033D35',
  chartreuse: '#D6FF84',
  cream: '#FAF5EF',
  purple: '#EAD3FF',
};

// ─── Local Storage ────────────────────────────────────────────────────────────
const CACHE_KEY   = 'brouser_cache_v3';
const FAV_KEY     = 'brouser_favorites_v3';
const HISTORY_KEY = 'brouser_history_v3';
const CACHE_TTL   = 1000 * 60 * 60; // 1 hour

const ls = {
  get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

const getCache = (key) => {
  const cache = ls.get(CACHE_KEY, {});
  const entry = cache[key];
  return entry && Date.now() - entry.ts < CACHE_TTL ? entry.data : null;
};

const setCache = (key, data) => {
  const cache = ls.get(CACHE_KEY, {});
  cache[key] = { data, ts: Date.now() };
  const keys = Object.keys(cache);
  if (keys.length > 50) delete cache[keys[0]];
  ls.set(CACHE_KEY, cache);
};

// ─── App ─────────────────────────────────────────────────────────────────────
export default function App() {
  const [theme, setTheme]                   = useState('');
  const [excludeMedia, setExcludeMedia]     = useState(true);
  const [newsletters, setNewsletters]       = useState([]);
  const [selected, setSelected]             = useState({});
  const [currentAnalysis, setCurrentAnalysis] = useState(null);
  const [favorites, setFavorites]           = useState(() => ls.get(FAV_KEY, []));
  const [searchHistory, setSearchHistory]   = useState(() => ls.get(HISTORY_KEY, []));

  const [sortBy, setSortBy]                 = useState('relevance');
  const [filterEngagement, setFilterEngagement] = useState('all');
  const [filterLocation, setFilterLocation] = useState('');
  const [filterLanguage, setFilterLanguage] = useState('all');
  const [showStats, setShowStats]           = useState(false);
  const [copiedUrl, setCopiedUrl]           = useState(null);

  const [exportProgress, setExportProgress] = useState({ current: 0, total: 0 });
  const [isLoading, setIsLoading]           = useState({ discovery: false, analysis: false, export: false });
  const [error, setError]                   = useState(null);

  useEffect(() => { ls.set(FAV_KEY, favorites); }, [favorites]);
  useEffect(() => { ls.set(HISTORY_KEY, searchHistory); }, [searchHistory]);

  // ── Helpers ────────────────────────────────────────────────────────────────
  const isFav = (url) => favorites.some((f) => f.url === url);

  const toggleFav = (newsletter) => {
    setFavorites((prev) =>
      prev.some((f) => f.url === newsletter.url)
        ? prev.filter((f) => f.url !== newsletter.url)
        : [...prev, newsletter]
    );
  };

  const addHistory = useCallback((term) => {
    setSearchHistory((prev) => [term, ...prev.filter((t) => t !== term)].slice(0, 10));
  }, []);

  const copyUrl = (url) => {
    navigator.clipboard.writeText(url);
    setCopiedUrl(url);
    setTimeout(() => setCopiedUrl(null), 2000);
  };

  // ── Discover ───────────────────────────────────────────────────────────────
  const handleDiscover = async () => {
    if (!theme.trim()) { setError('Please enter a search term.'); return; }

    const cacheKey = `discovery_${theme}_${excludeMedia}`;
    const cached = getCache(cacheKey);
    if (cached) {
      setNewsletters(cached);
      setSelected({});
      setCurrentAnalysis(null);
      return;
    }

    setIsLoading((p) => ({ ...p, discovery: true }));
    setError(null);
    setNewsletters([]);
    setSelected({});
    setCurrentAnalysis(null);
    addHistory(theme);

    try {
      const res  = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: theme, excludeMedia }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Search failed.');
      setNewsletters(data.newsletters || []);
      setCache(cacheKey, data.newsletters || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setIsLoading((p) => ({ ...p, discovery: false }));
    }
  };

  // ── Analyze ────────────────────────────────────────────────────────────────
  const handleAnalyze = async (newsletter) => {
    const cacheKey = `analysis_${newsletter.url}`;
    const cached = getCache(cacheKey);
    if (cached) { setCurrentAnalysis({ ...newsletter, ...cached }); return; }

    setCurrentAnalysis(null);
    setIsLoading((p) => ({ ...p, analysis: true }));

    try {
      const res  = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newsletter.name, url: newsletter.url }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Analysis failed.');
      setCache(cacheKey, data.analysis);
      setCurrentAnalysis({ ...newsletter, ...data.analysis });
    } catch (e) {
      setError(e.message);
    } finally {
      setIsLoading((p) => ({ ...p, analysis: false }));
    }
  };

  // ── Export ─────────────────────────────────────────────────────────────────
  const handleExport = async () => {
    const toExport = newsletters.filter((n) => selected[n.url]).slice(0, 25);
    if (!toExport.length) return;

    setIsLoading((p) => ({ ...p, export: true }));
    setError(null);
    setExportProgress({ current: 0, total: toExport.length });

    const analyses = [];
    for (let i = 0; i < toExport.length; i += 5) {
      const batch = toExport.slice(i, i + 5);
      setExportProgress({ current: i, total: toExport.length });
      const results = await Promise.all(
        batch.map(async (n) => {
          const cacheKey = `analysis_${n.url}`;
          const cached = getCache(cacheKey);
          if (cached) return cached;
          try {
            const res  = await fetch('/api/analyze', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ name: n.name, url: n.url }),
            });
            const data = await res.json();
            if (res.ok) { setCache(cacheKey, data.analysis); return data.analysis; }
          } catch {}
          return null;
        })
      );
      analyses.push(...results);
      if (i + 5 < toExport.length) await new Promise((r) => setTimeout(r, 500));
    }

    const rows = [
      ['Name','URL','Theme','Est. Reach','Engagement','Engagement Score','Contact','Location','Muck Rack','Categories','Frequency','Language','PR Insights','Publishing Insights'],
    ];
    toExport.forEach((n, i) => {
      const a = analyses[i];
      if (!a) return;
      const q = (s) => `"${String(s || '').replace(/"/g, '""')}"`;
      rows.push([
        q(n.name), q(n.url), q(a.theme), q(a.reach), q(a.engagement), q(a.engagement_score),
        q(a.contact), q(a.location), q(a.muckrack_url),
        q((a.categories || []).join(', ')), q(a.frequency), q(a.language),
        q(a.pr_insights), q(a.publishing_insights),
      ]);
    });

    const uri  = 'data:text/csv;charset=utf-8,' + encodeURI(rows.map((r) => r.join(',')).join('\n'));
    const link = Object.assign(document.createElement('a'), { href: uri, download: `brouser_${Date.now()}.csv` });
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    setIsLoading((p) => ({ ...p, export: false }));
    setExportProgress({ current: 0, total: 0 });
  };

  // ── Sorted + Filtered list ─────────────────────────────────────────────────
  const displayList = useMemo(() => {
    let list = [...newsletters];

    if (filterEngagement !== 'all') {
      list = list.filter((n) => {
        const c = getCache(`analysis_${n.url}`);
        return !c || c.engagement?.toLowerCase() === filterEngagement;
      });
    }
    if (filterLocation) {
      list = list.filter((n) => {
        const c = getCache(`analysis_${n.url}`);
        return !c || c.location?.toLowerCase().includes(filterLocation.toLowerCase());
      });
    }
    if (filterLanguage !== 'all') {
      list = list.filter((n) => {
        const c = getCache(`analysis_${n.url}`);
        return !c || (c.language || 'english').toLowerCase().includes(filterLanguage);
      });
    }

    list.sort((a, b) => {
      if (sortBy === 'name') return a.name.localeCompare(b.name);
      const ca = getCache(`analysis_${a.url}`);
      const cb = getCache(`analysis_${b.url}`);
      if (sortBy === 'engagement') return (cb?.engagement_score || 0) - (ca?.engagement_score || 0);
      if (sortBy === 'reach') {
        const parse = (s) => parseInt(String(s || '0').replace(/\D/g, '')) || 0;
        return parse(cb?.reach) - parse(ca?.reach);
      }
      // relevance: analyzed first, then by score
      const diff = (cb ? 1 : 0) - (ca ? 1 : 0);
      return diff !== 0 ? diff : (cb?.engagement_score || 0) - (ca?.engagement_score || 0);
    });

    return list;
  }, [newsletters, sortBy, filterEngagement, filterLocation, filterLanguage]);

  // ── Stats ──────────────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    if (!newsletters.length) return null;
    let total = 0, sum = 0;
    const dist = { high: 0, medium: 0, low: 0 };
    newsletters.forEach((n) => {
      const c = getCache(`analysis_${n.url}`);
      if (c) { total++; sum += c.engagement_score || 0; dist[c.engagement?.toLowerCase()] = (dist[c.engagement?.toLowerCase()] || 0) + 1; }
    });
    return { total: newsletters.length, analyzed: total, avgEngagement: total ? (sum / total).toFixed(1) : 0, distribution: dist };
  }, [newsletters, displayList]); // eslint-disable-line

  const selectedCount = Object.values(selected).filter(Boolean).length;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen text-white font-sans p-4 sm:p-6 md:p-10"
      style={{ background: `linear-gradient(135deg, ${C.green} 0%, #000000 50%, ${C.green} 100%)` }}>
      <div className="max-w-[1800px] mx-auto">

        {/* ── Header ── */}
        <header className="mb-8 relative">
          <div className="absolute top-0 right-0 text-right">
            <a href="http://www.thebrouhahacollective.com" target="_blank" rel="noopener noreferrer" className="inline-block group">
              <p className="text-xs text-gray-500 mb-0.5 group-hover:text-gray-400 transition-colors">the Brouhaha Collective</p>
              <p className="text-sm font-black tracking-[0.3em] group-hover:opacity-80 transition-opacity" style={{ color: C.chartreuse }}>IDEA LAB</p>
            </a>
          </div>

          <h1 className="text-5xl sm:text-6xl md:text-7xl lg:text-8xl font-black tracking-tighter leading-none" style={{ color: C.chartreuse }}>
            The Brouser™
          </h1>
          <p className="mt-3 text-lg sm:text-xl text-gray-300 font-light max-w-2xl">
            Your AI-powered shortcut to self-published newsletters
          </p>

          <div className="mt-5 p-5 border-l-4 rounded-r-xl" style={{ background: `${C.chartreuse}15`, borderColor: C.chartreuse }}>
            <p className="text-base text-gray-200 leading-relaxed">
              <span className="font-black tracking-wide" style={{ color: C.chartreuse }}>HOW IT WORKS: </span>
              <span className="font-light">We search Substack, Ghost, Beehiiv & more. Click any result for a deep dive, or check a few to export a list.</span>
            </p>
          </div>

          {stats && (
            <div className="mt-5 flex flex-wrap gap-3 text-sm">
              {[['found', stats.total], ['analyzed', stats.analyzed], ['favorites', favorites.length]].map(([label, val]) => (
                <div key={label} className="px-4 py-1.5 rounded-full backdrop-blur-sm border-2" style={{ background: `${C.chartreuse}20`, borderColor: `${C.chartreuse}60` }}>
                  <span className="font-black text-lg" style={{ color: C.chartreuse }}>{val}</span>
                  <span className="text-gray-300 ml-2 font-medium uppercase tracking-wide" style={{ fontSize: '0.7rem' }}>{label}</span>
                </div>
              ))}
            </div>
          )}
        </header>

        {/* ── Search ── */}
        <div className="border bg-opacity-50 p-6 sm:p-8 mb-8 rounded-2xl backdrop-blur-sm shadow-2xl"
          style={{ borderColor: `${C.chartreuse}30`, background: `${C.green}CC` }}>
          <h2 className="text-2xl font-black mb-5 text-white flex items-center tracking-wide">
            <Search className="mr-3" style={{ color: C.chartreuse }} />
            DISCOVER NEWSLETTERS
          </h2>

          <div className="flex flex-col gap-4">
            <div className="flex flex-col sm:flex-row gap-4">
              <input
                type="text"
                value={theme}
                onChange={(e) => setTheme(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleDiscover()}
                placeholder="Search by theme, newsletter name, or author..."
                className="flex-grow bg-black/60 border border-gray-700 text-white px-4 py-3 placeholder-gray-500 focus:outline-none focus:border-yellow-300 transition-all rounded-xl"
              />
              <button
                onClick={handleDiscover}
                disabled={isLoading.discovery}
                className="font-black py-3 px-8 flex items-center justify-center transition-all disabled:opacity-50 disabled:cursor-not-allowed rounded-xl shadow-lg hover:scale-105 transform"
                style={{ background: C.chartreuse, color: C.green }}
              >
                {isLoading.discovery ? <Loader2 className="animate-spin mr-2" /> : <Zap className="mr-2" />}
                FIND NEWSLETTERS
              </button>
            </div>

            {searchHistory.length > 0 && !theme && (
              <div className="flex flex-wrap gap-2 items-center">
                <Clock className="w-4 h-4 text-gray-500" />
                <span className="text-sm text-gray-500">Recent:</span>
                {searchHistory.slice(0, 5).map((t) => (
                  <button key={t} onClick={() => setTheme(t)}
                    className="text-xs px-3 py-1 rounded-full border transition-colors"
                    style={{ background: '#ffffff10', color: '#ccc', borderColor: '#ffffff20' }}>
                    {t}
                  </button>
                ))}
              </div>
            )}

            <div className="flex flex-wrap gap-4 items-center">
              <label className="flex items-center space-x-3 cursor-pointer group">
                <input type="checkbox" checked={excludeMedia} onChange={() => setExcludeMedia(!excludeMedia)}
                  className="form-checkbox h-5 w-5 bg-black border-gray-700 rounded" />
                <span className="text-gray-300 group-hover:text-white transition-colors text-sm">Exclude major media outlets</span>
              </label>

              {favorites.length > 0 && (
                <button onClick={() => setNewsletters(favorites)}
                  className="text-sm px-4 py-2 rounded-lg border flex items-center gap-2 transition-colors"
                  style={{ background: '#ffffff10', color: C.chartreuse, borderColor: `${C.chartreuse}30` }}>
                  <Star className="w-4 h-4" /> View Favorites ({favorites.length})
                </button>
              )}

              {stats && (
                <button onClick={() => setShowStats(!showStats)}
                  className="text-sm px-4 py-2 rounded-lg border flex items-center gap-2 transition-colors"
                  style={{ background: '#ffffff10', color: C.chartreuse, borderColor: `${C.chartreuse}30` }}>
                  <BarChart3 className="w-4 h-4" /> {showStats ? 'Hide' : 'Show'} Stats
                </button>
              )}
            </div>
          </div>

          {error && (
            <div className="mt-4 p-4 bg-red-900/30 border border-red-500/50 rounded-xl text-red-200 flex items-start gap-3">
              <X className="w-5 h-5 flex-shrink-0 mt-0.5" /><span>{error}</span>
            </div>
          )}
        </div>

        {/* ── Stats Dashboard ── */}
        {showStats && stats && (
          <div className="border p-6 mb-8 rounded-2xl backdrop-blur-sm" style={{ borderColor: `${C.chartreuse}30`, background: `${C.green}CC` }}>
            <h3 className="text-xl font-black mb-4 text-white flex items-center tracking-wide">
              <BarChart3 className="mr-3" style={{ color: C.chartreuse }} /> STATISTICS DASHBOARD
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard label="Total Found" value={stats.total} />
              <StatCard label="Analyzed" value={stats.analyzed} />
              <StatCard label="Avg Engagement Score" value={`${stats.avgEngagement}/10`} />
              <div className="bg-black/40 p-4 rounded-xl border border-gray-800">
                <p className="text-gray-400 text-sm mb-2">Engagement Distribution</p>
                {[['High', 'text-green-400', stats.distribution.high], ['Medium', 'text-yellow-400', stats.distribution.medium], ['Low', 'text-red-400', stats.distribution.low]].map(([l, cls, v]) => (
                  <div key={l} className="flex justify-between text-sm"><span className={cls}>{l}:</span><span className="text-white font-semibold">{v}</span></div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── Two-Column Main ── */}
        <main className="grid lg:grid-cols-[400px,1fr] gap-8">

          {/* LEFT — Analysis Panel */}
          <div className="border p-6 sm:p-8 rounded-2xl shadow-2xl sticky top-6 h-fit"
            style={{ borderColor: `${C.chartreuse}30`, background: `${C.green}F5` }}>
            <h3 className="text-xl font-black text-white mb-6 pb-4 border-b flex items-center tracking-wide" style={{ borderColor: '#ffffff20' }}>
              <Zap className="mr-3" style={{ color: C.chartreuse }} /> AI ANALYSIS
            </h3>

            {isLoading.analysis && (
              <div className="py-24 flex justify-center">
                <LoadingSpinner text="Deep-analyzing newsletter..." />
              </div>
            )}

            {currentAnalysis && !isLoading.analysis ? (
              <AnalysisPanel
                analysis={currentAnalysis}
                isFav={isFav(currentAnalysis.url)}
                onToggleFav={() => toggleFav(currentAnalysis)}
                copiedUrl={copiedUrl}
                onCopy={copyUrl}
                C={C}
              />
            ) : !isLoading.analysis && (
              <div className="text-center py-24 flex flex-col items-center opacity-50">
                <Zap className="w-16 h-16 text-gray-700 mb-4" />
                <p className="text-gray-500 text-lg">Select a newsletter to analyze.</p>
                <p className="text-gray-600 text-sm mt-2">Click any newsletter from the list</p>
              </div>
            )}
          </div>

          {/* RIGHT — Results */}
          <div className="border p-6 sm:p-8 rounded-2xl shadow-2xl"
            style={{ borderColor: `${C.chartreuse}30`, background: `${C.green}F5` }}>
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6 pb-4 border-b" style={{ borderColor: '#ffffff20' }}>
              <div className="flex items-center gap-3">
                <h3 className="text-xl font-black text-white flex items-center tracking-wide">
                  <Newspaper className="mr-3" style={{ color: C.chartreuse }} />
                  RESULTS
                  {displayList.length > 0 && <span className="ml-3 text-sm text-gray-400">({displayList.length})</span>}
                </h3>
                {(filterEngagement !== 'all' || filterLocation || filterLanguage !== 'all') && (
                  <button onClick={() => { setFilterEngagement('all'); setFilterLocation(''); setFilterLanguage('all'); }}
                    className="text-xs px-3 py-1 rounded-full border flex items-center gap-1"
                    style={{ background: '#ff000020', color: '#ff6b6b', borderColor: '#ff000030' }}>
                    <X className="w-3 h-3" /> Clear
                  </button>
                )}
              </div>

              <div className="flex flex-wrap gap-2">
                <Select value={sortBy} onChange={setSortBy} options={[['relevance','Sort: Relevance'],['name','Sort: Name'],['engagement','Sort: Engagement'],['reach','Sort: Reach']]} />
                <Select value={filterEngagement} onChange={setFilterEngagement} options={[['all','All Engagement'],['high','High Only'],['medium','Medium Only'],['low','Low Only']]} />
                <input type="text" value={filterLocation} onChange={(e) => setFilterLocation(e.target.value)}
                  placeholder="Location..."
                  className="bg-gray-800 border border-gray-700 text-gray-300 text-sm px-3 py-2 rounded-lg focus:outline-none placeholder-gray-500 w-32" />
                <Select value={filterLanguage} onChange={setFilterLanguage} options={[['all','All Languages'],['english','English'],['spanish','Spanish'],['french','French'],['other','Other']]} />

                {selectedCount > 0 && (
                  <button onClick={handleExport} disabled={isLoading.export}
                    className="font-semibold py-2 px-4 flex items-center text-sm disabled:opacity-50 rounded-lg border transition-colors"
                    style={{ background: `${C.chartreuse}30`, color: C.chartreuse, borderColor: `${C.chartreuse}50` }}>
                    {isLoading.export ? <Loader2 className="animate-spin mr-2 w-4 h-4" /> : <FileDown className="w-4 h-4 mr-2" />}
                    Export ({Math.min(selectedCount, 25)})
                  </button>
                )}
              </div>
            </div>

            {isLoading.discovery && (
              <div className="py-16 flex justify-center bg-black/20 rounded-xl border border-gray-800/50">
                <LoadingSpinner text="Searching the web for newsletters..." />
              </div>
            )}

            {isLoading.export && (
              <div className="py-8 bg-black/20 rounded-xl border border-gray-800/50 mb-4 px-4">
                <div className="flex justify-between text-xs mb-2 font-mono" style={{ color: C.chartreuse }}>
                  <span>ANALYZING NEWSLETTERS...</span>
                  <span>{exportProgress.current} / {exportProgress.total}</span>
                </div>
                <div className="w-full bg-gray-800 rounded-full h-2.5 overflow-hidden">
                  <div className="h-2.5 transition-all duration-300"
                    style={{ width: `${(exportProgress.current / Math.max(exportProgress.total, 1)) * 100}%`, background: C.chartreuse }} />
                </div>
                <p className="text-center text-xs text-gray-400 mt-2">Processing in optimized batches...</p>
              </div>
            )}

            {displayList.length > 0 && !isLoading.discovery && (
              <ul className="space-y-3 max-h-[900px] overflow-y-auto pr-2 custom-scrollbar">
                {displayList.map((n) => {
                  const cached = getCache(`analysis_${n.url}`);
                  return (
                    <li key={n.url}
                      className="flex items-start gap-3 p-4 bg-black/40 border hover:border-opacity-100 transition-all rounded-xl group"
                      style={{ borderColor: '#ffffff20' }}>
                      <div className="flex items-center h-full pt-1.5">
                        <input type="checkbox" checked={!!selected[n.url]}
                          onChange={() => setSelected((p) => ({ ...p, [n.url]: !p[n.url] }))}
                          className="form-checkbox h-5 w-5 bg-black border-gray-600 cursor-pointer rounded" />
                      </div>
                      <div className="flex-grow min-w-0">
                        <div className="flex items-start justify-between gap-2 mb-1">
                          <button onClick={() => handleAnalyze(n)} disabled={isLoading.analysis}
                            className="flex-grow text-left focus:outline-none disabled:opacity-50 disabled:cursor-wait">
                            <p className="font-bold text-white hover:opacity-80 transition-colors leading-tight">{n.name}</p>
                          </button>
                          <div className="flex gap-1 flex-shrink-0">
                            <button onClick={() => toggleFav(n)} className="p-1.5 hover:bg-gray-700/50 rounded-lg transition-colors">
                              {isFav(n.url)
                                ? <Star className="w-4 h-4" style={{ color: C.chartreuse, fill: C.chartreuse }} />
                                : <StarOff className="w-4 h-4 text-gray-500 group-hover:text-gray-300" />}
                            </button>
                            <button onClick={() => copyUrl(n.url)} className="p-1.5 hover:bg-gray-700/50 rounded-lg transition-colors">
                              {copiedUrl === n.url
                                ? <Check className="w-4 h-4" style={{ color: C.chartreuse }} />
                                : <Copy className="w-4 h-4 text-gray-500 group-hover:text-gray-300" />}
                            </button>
                          </div>
                        </div>
                        <p className="text-xs text-gray-500 truncate mb-2">{n.url}</p>
                        {cached && (
                          <div className="flex flex-wrap gap-2 text-xs">
                            {cached.categories?.map((cat) => (
                              <span key={cat} className="px-2 py-0.5 rounded-full border"
                                style={{ background: `${C.chartreuse}30`, color: C.chartreuse, borderColor: `${C.chartreuse}50` }}>
                                {cat}
                              </span>
                            ))}
                            {cached.engagement && <span className="bg-gray-800/50 text-gray-400 px-2 py-0.5 rounded-full">{cached.engagement}</span>}
                            {cached.frequency  && <span className="bg-gray-800/50 text-gray-400 px-2 py-0.5 rounded-full">{cached.frequency}</span>}
                          </div>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}

            {!isLoading.discovery && displayList.length === 0 && newsletters.length === 0 && (
              <EmptyState icon={Search} text="Enter a search term to discover newsletters." sub='Try searching for "travel", "tech", or "finance"' />
            )}
            {!isLoading.discovery && displayList.length === 0 && newsletters.length > 0 && (
              <EmptyState icon={Filter} text="No newsletters match your filters."
                action={<button onClick={() => { setFilterEngagement('all'); setFilterLocation(''); setFilterLanguage('all'); }}
                  className="mt-4 text-sm hover:underline" style={{ color: C.chartreuse }}>Clear all filters</button>} />
            )}
          </div>
        </main>

        <div className="mt-8 text-center text-xs text-gray-600">
          💡 <span className="text-gray-500">Tip:</span> Use checkboxes to multi-select newsletters for batch CSV export
        </div>
      </div>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 8px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: rgba(0,0,0,.2); border-radius: 4px; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: ${C.chartreuse}50; border-radius: 4px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: ${C.chartreuse}80; }
      `}</style>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatCard({ label, value }) {
  return (
    <div className="bg-black/40 p-4 rounded-xl border border-gray-800">
      <p className="text-gray-400 text-sm mb-1">{label}</p>
      <p className="text-3xl font-black" style={{ color: '#D6FF84' }}>{value}</p>
    </div>
  );
}

function LoadingSpinner({ text }) {
  return (
    <div className="flex flex-col items-center justify-center space-y-2" style={{ color: '#D6FF84' }}>
      <div className="flex items-center space-x-2">
        <Loader2 className="animate-spin h-5 w-5" />
        <span className="font-semibold">{text}</span>
      </div>
    </div>
  );
}

function EmptyState({ icon: Icon, text, sub, action }) {
  return (
    <div className="text-center py-24 border border-dashed border-gray-800 rounded-xl opacity-50">
      <Icon className="w-16 h-16 mx-auto text-gray-700 mb-4" />
      <p className="text-gray-500 text-lg">{text}</p>
      {sub && <p className="text-gray-600 text-sm mt-2">{sub}</p>}
      {action}
    </div>
  );
}

function Select({ value, onChange, options }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}
      className="bg-gray-800 border border-gray-700 text-gray-300 text-sm px-3 py-2 rounded-lg focus:outline-none appearance-none">
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
}

function AnalysisPanel({ analysis, isFav, onToggleFav, copiedUrl, onCopy, C }) {
  const a = analysis;
  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-start justify-between gap-3 mb-2">
          <h4 className="text-2xl font-black tracking-tight leading-tight" style={{ color: C.chartreuse }}>{a.name}</h4>
          <button onClick={onToggleFav} className="p-2 hover:bg-gray-800/50 rounded-lg transition-colors flex-shrink-0">
            {isFav
              ? <Star className="w-6 h-6" style={{ color: C.chartreuse, fill: C.chartreuse }} />
              : <StarOff className="w-6 h-6 text-gray-500" />}
          </button>
        </div>
        <a href={a.url} target="_blank" rel="noopener noreferrer"
          className="text-sm hover:underline break-all block transition-colors" style={{ color: `${C.chartreuse}CC` }}>
          {a.url}
        </a>
        {(a.categories?.length > 0 || a.frequency || a.language) && (
          <div className="flex flex-wrap gap-2 mt-3">
            {a.categories?.map((cat) => (
              <span key={cat} className="text-xs px-3 py-1 rounded-full border font-medium"
                style={{ background: `${C.chartreuse}30`, color: C.chartreuse, borderColor: `${C.chartreuse}50` }}>
                {cat}
              </span>
            ))}
            {a.frequency && <span className="bg-gray-800/50 text-gray-300 text-xs px-3 py-1 rounded-full border border-gray-700">📅 {a.frequency}</span>}
            {a.language  && <span className="bg-gray-800/50 text-gray-300 text-xs px-3 py-1 rounded-full border border-gray-700">🌐 {a.language}</span>}
          </div>
        )}
      </div>

      <InfoBlock icon={MessageSquare} label="Theme" C={C}><p className="text-gray-200 font-light leading-relaxed text-sm">{a.theme}</p></InfoBlock>

      <div className="grid grid-cols-2 gap-4">
        <MetricCard icon={Users} label="Reach" value={a.reach} />
        <MetricCard icon={MessageSquare} label="Engagement" value={a.engagement} sub={`${a.engagement_score}/10`} />
      </div>

      <InfoBlock icon={MapPin} label="Location" C={C}><p className="text-gray-300 font-light pl-6 text-sm">{a.location}</p></InfoBlock>

      <InfoBlock icon={Mail} label="Contact" C={C}>
        <div className="pl-6">
          {a.contact?.includes('@')
            ? <a href={`mailto:${a.contact}`} className="hover:underline break-all font-light text-sm" style={{ color: C.chartreuse }}>{a.contact}</a>
            : a.contact?.startsWith('http')
              ? <a href={a.contact} target="_blank" rel="noopener noreferrer" className="hover:underline font-light text-sm" style={{ color: C.chartreuse }}>Contact Form / Page</a>
              : <p className="text-gray-300 font-light text-sm">{a.contact}</p>}
        </div>
      </InfoBlock>

      <div className="border-t pt-4" style={{ borderColor: '#ffffff20' }}>
        <div className="flex justify-between items-center mb-2">
          <p className="font-bold text-gray-400 flex items-center text-sm uppercase tracking-wide">
            <Briefcase className="w-4 h-4 mr-2" style={{ color: C.chartreuse }} /> PR Insights
          </p>
          {a.muckrack_url && a.muckrack_url !== 'Not found' && (
            <a href={a.muckrack_url} target="_blank" rel="noopener noreferrer"
              className="text-xs px-3 py-1.5 rounded-lg border transition-colors"
              style={{ background: '#ffffff10', color: C.chartreuse, borderColor: `${C.chartreuse}30` }}>
              Muck Rack
            </a>
          )}
        </div>
        <p className="text-gray-300 font-light pl-6 leading-relaxed text-sm">{a.pr_insights}</p>
      </div>

      <InfoBlock icon={DollarSign} label="Publishing Insight" C={C}><p className="text-gray-300 font-light pl-6 leading-relaxed text-sm">{a.publishing_insights}</p></InfoBlock>

      <div className="pt-4 flex gap-2" style={{ borderTop: '1px solid #ffffff20' }}>
        <button onClick={() => onCopy(a.url)}
          className="flex-1 text-white text-sm px-4 py-2 rounded-lg border flex items-center justify-center gap-2 transition-colors"
          style={{ background: '#ffffff10', borderColor: '#ffffff20' }}>
          {copiedUrl === a.url ? <><Check className="w-4 h-4" /> Copied!</> : <><Copy className="w-4 h-4" /> Copy URL</>}
        </button>
      </div>
    </div>
  );
}

function InfoBlock({ icon: Icon, label, children, C }) {
  return (
    <div className="border-t pt-4" style={{ borderColor: '#ffffff20' }}>
      <p className="font-bold text-gray-400 mb-2 flex items-center text-sm uppercase tracking-wide">
        <Icon className="w-4 h-4 mr-2" style={{ color: '#D6FF84' }} /> {label}
      </p>
      {children}
    </div>
  );
}

function MetricCard({ icon: Icon, label, value, sub }) {
  return (
    <div className="bg-gray-800/60 p-4 rounded-xl border border-gray-700/50">
      <p className="text-xs text-gray-400 mb-1 flex items-center uppercase tracking-widest">
        <Icon className="w-3 h-3 mr-2" /> {label}
      </p>
      <p className="font-bold text-xl text-white">
        {value}
        {sub && <span className="text-sm text-gray-400 ml-2">({sub})</span>}
      </p>
    </div>
  );
}
