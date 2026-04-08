import React, { useState, useCallback, useMemo } from 'react';
import {
  Search, Users, MessageSquare, Zap, Loader2, Mail,
  FileDown, MapPin, Briefcase, DollarSign, Filter,
  Star, StarOff, BarChart3, X, Clock, Copy, Check,
} from 'lucide-react';

// ─── Local Storage ────────────────────────────────────────────────────────────
const CACHE_KEY   = 'brouser_cache_v3';
const FAV_KEY     = 'brouser_favorites_v3';
const HISTORY_KEY = 'brouser_history_v3';
const CACHE_TTL   = 1000 * 60 * 60;

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
  const [theme, setTheme]               = useState('');
  const [excludeMedia, setExcludeMedia] = useState(true);
  const [newsletters, setNewsletters]   = useState([]);
  const [selected, setSelected]         = useState({});
  const [currentAnalysis, setCurrentAnalysis] = useState(null);
  const [favorites, setFavorites]       = useState(() => ls.get(FAV_KEY, []));
  const [searchHistory, setSearchHistory] = useState(() => ls.get(HISTORY_KEY, []));

  const [sortBy, setSortBy]                     = useState('relevance');
  const [filterEngagement, setFilterEngagement] = useState('all');
  const [filterLocation, setFilterLocation]     = useState('');
  const [filterLanguage, setFilterLanguage]     = useState('all');
  const [showStats, setShowStats]               = useState(false);
  const [copiedUrl, setCopiedUrl]               = useState(null);

  const [exportProgress, setExportProgress] = useState({ current: 0, total: 0 });
  const [isLoading, setIsLoading] = useState({ discovery: false, analysis: false, export: false });
  const [error, setError] = useState(null);

  // Persist
  const saveFavorites = (f) => { setFavorites(f); ls.set(FAV_KEY, f); };
  const isFav = (url) => favorites.some((f) => f.url === url);
  const toggleFav = (n) => saveFavorites(isFav(n.url) ? favorites.filter((f) => f.url !== n.url) : [...favorites, n]);

  const addHistory = useCallback((term) => {
    setSearchHistory((p) => { const h = [term, ...p.filter((t) => t !== term)].slice(0, 10); ls.set(HISTORY_KEY, h); return h; });
  }, []);

  const copyUrl = (url) => { navigator.clipboard.writeText(url); setCopiedUrl(url); setTimeout(() => setCopiedUrl(null), 2000); };

  // ── Discover ────────────────────────────────────────────────────────────────
  const handleDiscover = async () => {
    if (!theme.trim()) { setError('Please enter a search term.'); return; }
    const cacheKey = `discovery_${theme}_${excludeMedia}`;
    const cached = getCache(cacheKey);
    if (cached) { setNewsletters(cached); setSelected({}); setCurrentAnalysis(null); return; }

    setIsLoading((p) => ({ ...p, discovery: true }));
    setError(null); setNewsletters([]); setSelected({}); setCurrentAnalysis(null);
    addHistory(theme);

    try {
      const res  = await fetch('/api/search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: theme, excludeMedia }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Search failed.');
      setNewsletters(data.newsletters || []);
      setCache(cacheKey, data.newsletters || []);
    } catch (e) { setError(e.message); }
    finally { setIsLoading((p) => ({ ...p, discovery: false })); }
  };

  // ── Analyze ─────────────────────────────────────────────────────────────────
  const handleAnalyze = async (newsletter) => {
    const cacheKey = `analysis_${newsletter.url}`;
    const cached = getCache(cacheKey);
    if (cached) { setCurrentAnalysis({ ...newsletter, ...cached }); return; }

    setCurrentAnalysis(null);
    setIsLoading((p) => ({ ...p, analysis: true }));
    try {
      const res  = await fetch('/api/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: newsletter.name, url: newsletter.url }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Analysis failed.');
      setCache(cacheKey, data.analysis);
      setCurrentAnalysis({ ...newsletter, ...data.analysis });
    } catch (e) { setError(e.message); }
    finally { setIsLoading((p) => ({ ...p, analysis: false })); }
  };

  // ── Export ──────────────────────────────────────────────────────────────────
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
      const results = await Promise.all(batch.map(async (n) => {
        const ck = `analysis_${n.url}`;
        const c = getCache(ck);
        if (c) return c;
        try {
          const res = await fetch('/api/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: n.name, url: n.url }) });
          const d = await res.json();
          if (res.ok) { setCache(ck, d.analysis); return d.analysis; }
        } catch {}
        return null;
      }));
      analyses.push(...results);
      if (i + 5 < toExport.length) await new Promise((r) => setTimeout(r, 500));
    }

    const rows = [['Name','URL','Theme','Est. Reach','Engagement','Engagement Score','Contact','Location','Muck Rack','Categories','Frequency','Language','PR Insights','Publishing Insights']];
    toExport.forEach((n, i) => {
      const a = analyses[i]; if (!a) return;
      const q = (s) => `"${String(s || '').replace(/"/g, '""')}"`;
      rows.push([q(n.name),q(n.url),q(a.theme),q(a.reach),q(a.engagement),q(a.engagement_score),q(a.contact),q(a.location),q(a.muckrack_url),q((a.categories||[]).join(', ')),q(a.frequency),q(a.language),q(a.pr_insights),q(a.publishing_insights)]);
    });
    const link = Object.assign(document.createElement('a'), { href: 'data:text/csv;charset=utf-8,' + encodeURI(rows.map((r) => r.join(',')).join('\n')), download: `brouser_${Date.now()}.csv` });
    document.body.appendChild(link); link.click(); document.body.removeChild(link);
    setIsLoading((p) => ({ ...p, export: false }));
    setExportProgress({ current: 0, total: 0 });
  };

  // ── Sorted + Filtered ───────────────────────────────────────────────────────
  const displayList = useMemo(() => {
    let list = [...newsletters];
    if (filterEngagement !== 'all') list = list.filter((n) => { const c = getCache(`analysis_${n.url}`); return !c || c.engagement?.toLowerCase() === filterEngagement; });
    if (filterLocation) list = list.filter((n) => { const c = getCache(`analysis_${n.url}`); return !c || c.location?.toLowerCase().includes(filterLocation.toLowerCase()); });
    if (filterLanguage !== 'all') list = list.filter((n) => { const c = getCache(`analysis_${n.url}`); return !c || (c.language || 'english').toLowerCase().includes(filterLanguage); });
    list.sort((a, b) => {
      if (sortBy === 'name') return a.name.localeCompare(b.name);
      const ca = getCache(`analysis_${a.url}`), cb = getCache(`analysis_${b.url}`);
      if (sortBy === 'engagement') return (cb?.engagement_score || 0) - (ca?.engagement_score || 0);
      if (sortBy === 'reach') { const p = (s) => parseInt(String(s||'0').replace(/\D/g,''))||0; return p(cb?.reach) - p(ca?.reach); }
      const diff = (cb ? 1 : 0) - (ca ? 1 : 0);
      return diff !== 0 ? diff : (cb?.engagement_score || 0) - (ca?.engagement_score || 0);
    });
    return list;
  }, [newsletters, sortBy, filterEngagement, filterLocation, filterLanguage]); // eslint-disable-line

  // ── Stats ───────────────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    if (!newsletters.length) return null;
    let total = 0, sum = 0;
    const dist = { high: 0, medium: 0, low: 0 };
    newsletters.forEach((n) => { const c = getCache(`analysis_${n.url}`); if (c) { total++; sum += c.engagement_score || 0; const k = c.engagement?.toLowerCase(); if (k in dist) dist[k]++; } });
    return { total: newsletters.length, analyzed: total, avgEngagement: total ? (sum / total).toFixed(1) : '—', distribution: dist };
  }, [newsletters, displayList]); // eslint-disable-line

  const selectedCount = Object.values(selected).filter(Boolean).length;

  // ─── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--ink)', fontFamily: "'Space Grotesk', sans-serif" }}>

      {/* ── Masthead ── */}
      <header style={{ borderBottom: '1px solid var(--border)', padding: '0 2rem' }}>
        {/* Top accent line */}
        <div style={{ height: 3, background: 'var(--accent)', marginLeft: '-2rem', marginRight: '-2rem' }} />

        <div style={{ maxWidth: 1600, margin: '0 auto', padding: '1.5rem 0', display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: '2rem' }}>
          <div>
            <h1 className="font-display" style={{ fontSize: 'clamp(3rem, 8vw, 6rem)', lineHeight: 0.9, margin: 0, color: 'var(--ink)', letterSpacing: '-0.02em', fontWeight: 400 }}>
              The Brouser™
            </h1>
            <p style={{ margin: '0.5rem 0 0', color: 'var(--ink-dim)', fontSize: '0.8rem', letterSpacing: '0.06em', textTransform: 'uppercase', fontWeight: 500 }}>
              AI-powered newsletter discovery &nbsp;·&nbsp; by Brouhaha Collective
            </p>
          </div>

          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <a href="http://www.thebrouhahacollective.com" target="_blank" rel="noopener noreferrer"
              style={{ textDecoration: 'none', display: 'block' }}>
              <span className="label" style={{ display: 'block', color: 'var(--ink-dim)', marginBottom: 4 }}>the Brouhaha Collective</span>
              <span style={{ fontWeight: 700, letterSpacing: '0.25em', fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--accent)' }}>IDEA LAB</span>
            </a>
          </div>
        </div>
      </header>

      <div style={{ maxWidth: 1600, margin: '0 auto', padding: '2rem' }}>

        {/* ── How It Works ── */}
        <div style={{ borderLeft: '3px solid var(--accent)', paddingLeft: '1rem', marginBottom: '2rem', maxWidth: 700 }}>
          <span style={{ fontWeight: 700, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.12em', fontSize: '0.65rem' }}>How it works</span>
          <p style={{ margin: '0.25rem 0 0', color: 'var(--ink-mid)', fontSize: '0.85rem', lineHeight: 1.6 }}>
            We search Substack, Ghost, beehiiv & more. Click any result for a deep-dive intelligence brief, or select a few to export a full media list.
          </p>
        </div>

        {/* ── Quick Stats ── */}
        {stats && (
          <div style={{ display: 'flex', gap: '1rem', marginBottom: '2rem', flexWrap: 'wrap' }}>
            {[['found', stats.total], ['analyzed', stats.analyzed], ['saved', favorites.length]].map(([label, val]) => (
              <div key={label} style={{ display: 'flex', alignItems: 'baseline', gap: '0.4rem', padding: '0.4rem 0.85rem', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6 }}>
                <span style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--accent)' }}>{val}</span>
                <span className="label">{label}</span>
              </div>
            ))}
            <button onClick={() => setShowStats(!showStats)}
              style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.4rem 0.85rem', background: 'transparent', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--ink-dim)', cursor: 'pointer', fontSize: '0.72rem', letterSpacing: '0.1em', textTransform: 'uppercase', fontFamily: 'inherit' }}>
              <BarChart3 size={12} /> {showStats ? 'Hide' : 'View'} Stats
            </button>
          </div>
        )}

        {/* ── Stats Dashboard ── */}
        {showStats && stats && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '1rem', marginBottom: '2rem', padding: '1.25rem', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8 }}>
            <StatCell label="Total Found"      value={stats.total} />
            <StatCell label="Analyzed"         value={stats.analyzed} />
            <StatCell label="Avg Engagement"   value={`${stats.avgEngagement}/10`} />
            <div>
              <span className="label" style={{ display: 'block', marginBottom: 8 }}>Distribution</span>
              {[['High','#4ade80'], ['Medium','#facc15'], ['Low','var(--danger)']].map(([l, clr]) => (
                <div key={l} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', marginBottom: 3 }}>
                  <span style={{ color: clr }}>{l}</span>
                  <span style={{ color: 'var(--ink)', fontWeight: 600 }}>{stats.distribution[l.toLowerCase()]}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Search ── */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '1.5rem', marginBottom: '2rem' }}>
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            <div style={{ position: 'relative', flex: 1, minWidth: 260 }}>
              <Search size={15} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink-dim)', pointerEvents: 'none' }} />
              <input
                type="text"
                value={theme}
                onChange={(e) => setTheme(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleDiscover()}
                placeholder="Search by theme, newsletter name, or author…"
                style={{ width: '100%', background: 'var(--surface-2)', border: '1px solid var(--border-2)', borderRadius: 7, padding: '0.7rem 0.75rem 0.7rem 2.2rem', color: 'var(--ink)', fontSize: '0.875rem', outline: 'none', fontFamily: 'inherit', transition: 'border-color 0.15s' }}
                onFocus={(e) => e.target.style.borderColor = 'var(--accent)'}
                onBlur={(e) => e.target.style.borderColor = 'var(--border-2)'}
              />
            </div>
            <button
              onClick={handleDiscover}
              disabled={isLoading.discovery}
              style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.7rem 1.4rem', background: isLoading.discovery ? 'var(--border-2)' : 'var(--accent)', color: 'var(--brand)', border: 'none', borderRadius: 7, fontWeight: 700, fontSize: '0.8rem', letterSpacing: '0.08em', textTransform: 'uppercase', cursor: isLoading.discovery ? 'not-allowed' : 'pointer', fontFamily: 'inherit', transition: 'opacity 0.15s', whiteSpace: 'nowrap' }}
            >
              {isLoading.discovery ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
              Find Newsletters
            </button>
          </div>

          {/* Options row */}
          <div style={{ display: 'flex', gap: '1.5rem', marginTop: '0.85rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', color: 'var(--ink-mid)', fontSize: '0.8rem' }}>
              <input type="checkbox" checked={excludeMedia} onChange={() => setExcludeMedia(!excludeMedia)} style={{ accentColor: 'var(--accent)' }} />
              Exclude major media outlets
            </label>

            {favorites.length > 0 && (
              <button onClick={() => setNewsletters(favorites)}
                style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', background: 'transparent', border: 'none', color: 'var(--ink-mid)', cursor: 'pointer', fontSize: '0.8rem', fontFamily: 'inherit', padding: 0 }}>
                <Star size={13} style={{ color: 'var(--accent)' }} /> View Saved ({favorites.length})
              </button>
            )}

            {/* Search history */}
            {searchHistory.length > 0 && !theme && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                <Clock size={11} style={{ color: 'var(--ink-dim)' }} />
                <span className="label">Recent:</span>
                {searchHistory.slice(0, 5).map((t) => (
                  <button key={t} onClick={() => setTheme(t)}
                    style={{ background: 'transparent', border: 'none', color: 'var(--ink-dim)', cursor: 'pointer', fontSize: '0.78rem', fontFamily: 'inherit', padding: 0, textDecoration: 'underline', textDecorationStyle: 'dotted', textUnderlineOffset: 3 }}>
                    {t}
                  </button>
                ))}
              </div>
            )}
          </div>

          {error && (
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', marginTop: '0.85rem', padding: '0.75rem 1rem', background: 'rgba(255,107,107,0.08)', border: '1px solid rgba(255,107,107,0.25)', borderRadius: 7, color: 'var(--danger)', fontSize: '0.82rem' }}>
              <X size={14} style={{ flexShrink: 0, marginTop: 2 }} />{error}
            </div>
          )}
        </div>

        {/* ── Two-Column Layout ── */}
        <div style={{ display: 'grid', gridTemplateColumns: '380px 1fr', gap: '1.5rem', alignItems: 'start' }}>

          {/* LEFT — Dossier Panel */}
          <div style={{ position: 'sticky', top: '1.5rem', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
            {/* Panel header */}
            <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span className="label" style={{ color: 'var(--accent)' }}>Intelligence Brief</span>
              <div style={{ flex: 1, height: 1, background: 'var(--border)', marginLeft: '0.5rem' }} />
            </div>

            {isLoading.analysis && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '5rem 1.25rem', gap: '0.75rem' }}>
                <Loader2 size={20} className="animate-spin" style={{ color: 'var(--accent)' }} />
                <span style={{ color: 'var(--ink-dim)', fontSize: '0.8rem', letterSpacing: '0.06em' }}>Researching newsletter…</span>
              </div>
            )}

            {currentAnalysis && !isLoading.analysis
              ? <DossierPanel analysis={currentAnalysis} isFav={isFav(currentAnalysis.url)} onToggleFav={() => toggleFav(currentAnalysis)} copiedUrl={copiedUrl} onCopy={copyUrl} />
              : !isLoading.analysis && (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '5rem 1.25rem', textAlign: 'center', opacity: 0.4 }}>
                  <Zap size={28} style={{ color: 'var(--ink-dim)', marginBottom: '0.75rem' }} />
                  <p style={{ margin: 0, color: 'var(--ink-dim)', fontSize: '0.85rem' }}>Select a newsletter to generate a brief</p>
                </div>
              )
            }
          </div>

          {/* RIGHT — Results */}
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
            {/* Results toolbar */}
            <div style={{ padding: '0.85rem 1.25rem', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
              <span className="label" style={{ color: 'var(--accent)' }}>
                Newsletters {displayList.length > 0 && `(${displayList.length})`}
              </span>
              <div style={{ flex: 1 }} />

              {/* Filters */}
              <DossierSelect value={sortBy} onChange={setSortBy} options={[['relevance','Relevance'],['name','Name'],['engagement','Engagement'],['reach','Reach']]} prefix="Sort:" />
              <DossierSelect value={filterEngagement} onChange={setFilterEngagement} options={[['all','Engagement'],['high','High'],['medium','Medium'],['low','Low']]} />
              <input type="text" value={filterLocation} onChange={(e) => setFilterLocation(e.target.value)} placeholder="Location…"
                style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 5, padding: '0.3rem 0.6rem', color: 'var(--ink)', fontSize: '0.75rem', width: 110, fontFamily: 'inherit', outline: 'none' }} />
              <DossierSelect value={filterLanguage} onChange={setFilterLanguage} options={[['all','Language'],['english','English'],['spanish','Spanish'],['french','French'],['other','Other']]} />

              {(filterEngagement !== 'all' || filterLocation || filterLanguage !== 'all') && (
                <button onClick={() => { setFilterEngagement('all'); setFilterLocation(''); setFilterLanguage('all'); }}
                  style={{ display: 'flex', alignItems: 'center', gap: 3, background: 'transparent', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.72rem', padding: 0 }}>
                  <X size={11} /> Clear
                </button>
              )}

              {selectedCount > 0 && (
                <button onClick={handleExport} disabled={isLoading.export}
                  style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', padding: '0.3rem 0.75rem', background: 'transparent', border: `1px solid var(--accent)`, borderRadius: 5, color: 'var(--accent)', cursor: 'pointer', fontSize: '0.72rem', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', fontFamily: 'inherit' }}>
                  {isLoading.export ? <Loader2 size={11} className="animate-spin" /> : <FileDown size={11} />}
                  Export {Math.min(selectedCount, 25)}
                </button>
              )}
            </div>

            {/* Export progress */}
            {isLoading.export && (
              <div style={{ padding: '0.75rem 1.25rem', borderBottom: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', marginBottom: 6, color: 'var(--ink-dim)' }}>
                  <span style={{ letterSpacing: '0.08em', textTransform: 'uppercase' }}>Analyzing batch…</span>
                  <span style={{ color: 'var(--accent)', fontWeight: 600 }}>{exportProgress.current} / {exportProgress.total}</span>
                </div>
                <div style={{ height: 2, background: 'var(--border)', borderRadius: 1, overflow: 'hidden' }}>
                  <div style={{ height: '100%', background: 'var(--accent)', width: `${(exportProgress.current / Math.max(exportProgress.total, 1)) * 100}%`, transition: 'width 0.3s ease' }} />
                </div>
              </div>
            )}

            {/* Discovery loading */}
            {isLoading.discovery && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.75rem', padding: '4rem 1.25rem' }}>
                <Loader2 size={16} className="animate-spin" style={{ color: 'var(--accent)' }} />
                <span style={{ color: 'var(--ink-dim)', fontSize: '0.82rem', letterSpacing: '0.04em' }}>Searching across platforms…</span>
              </div>
            )}

            {/* Results list */}
            {!isLoading.discovery && displayList.length > 0 && (
              <ul className="scroll-thin" style={{ listStyle: 'none', margin: 0, padding: '0.5rem 0', maxHeight: '75vh', overflowY: 'auto' }}>
                {displayList.map((n, i) => {
                  const cached   = getCache(`analysis_${n.url}`);
                  const isActive = currentAnalysis?.url === n.url;
                  return (
                    <li key={n.url} className="fade-up"
                      style={{ animationDelay: `${i * 20}ms`, borderLeft: isActive ? '3px solid var(--accent)' : '3px solid transparent', padding: '0.75rem 1.25rem', display: 'flex', gap: '0.75rem', alignItems: 'flex-start', borderBottom: '1px solid var(--border)', transition: 'background 0.1s', cursor: 'default' }}
                      onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = 'var(--surface-2)'; }}
                      onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                    >
                      <input type="checkbox" checked={!!selected[n.url]} onChange={() => setSelected((p) => ({ ...p, [n.url]: !p[n.url] }))}
                        style={{ marginTop: 3, flexShrink: 0, accentColor: 'var(--accent)', cursor: 'pointer' }} />

                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', justifyContent: 'space-between' }}>
                          <button onClick={() => handleAnalyze(n)} disabled={isLoading.analysis}
                            style={{ background: 'none', border: 'none', padding: 0, textAlign: 'left', cursor: 'pointer', color: isActive ? 'var(--accent)' : 'var(--ink)', fontWeight: 600, fontSize: '0.875rem', fontFamily: 'inherit', lineHeight: 1.3, flex: 1 }}>
                            {n.name}
                          </button>
                          <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
                            <IconBtn onClick={() => toggleFav(n)} title={isFav(n.url) ? 'Unsave' : 'Save'}>
                              {isFav(n.url) ? <Star size={13} style={{ color: 'var(--accent)', fill: 'var(--accent)' }} /> : <StarOff size={13} style={{ color: 'var(--ink-dim)' }} />}
                            </IconBtn>
                            <IconBtn onClick={() => copyUrl(n.url)} title="Copy URL">
                              {copiedUrl === n.url ? <Check size={13} style={{ color: 'var(--accent)' }} /> : <Copy size={13} style={{ color: 'var(--ink-dim)' }} />}
                            </IconBtn>
                          </div>
                        </div>

                        <p style={{ margin: '2px 0 0', color: 'var(--ink-dim)', fontSize: '0.72rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.url}</p>

                        {cached && (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem', marginTop: '0.4rem' }}>
                            {cached.categories?.map((cat) => (
                              <span key={cat} style={{ background: 'var(--purple)', color: '#4B3070', fontSize: '0.65rem', fontWeight: 600, padding: '0.1rem 0.5rem', borderRadius: 100, letterSpacing: '0.04em' }}>{cat}</span>
                            ))}
                            {cached.engagement && <span style={{ background: 'var(--surface-3)', color: 'var(--ink-mid)', fontSize: '0.65rem', padding: '0.1rem 0.5rem', borderRadius: 100 }}>{cached.engagement}</span>}
                            {cached.frequency  && <span style={{ background: 'var(--surface-3)', color: 'var(--ink-mid)', fontSize: '0.65rem', padding: '0.1rem 0.5rem', borderRadius: 100 }}>{cached.frequency}</span>}
                          </div>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}

            {/* Empty states */}
            {!isLoading.discovery && displayList.length === 0 && newsletters.length === 0 && (
              <EmptyState icon={Search} text="Enter a search term above to discover newsletters." />
            )}
            {!isLoading.discovery && displayList.length === 0 && newsletters.length > 0 && (
              <EmptyState icon={Filter} text="No newsletters match your current filters.">
                <button onClick={() => { setFilterEngagement('all'); setFilterLocation(''); setFilterLanguage('all'); }}
                  style={{ background: 'transparent', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: '0.78rem', textDecoration: 'underline', fontFamily: 'inherit', marginTop: '0.5rem' }}>
                  Clear all filters
                </button>
              </EmptyState>
            )}
          </div>
        </div>

        <p style={{ textAlign: 'center', color: 'var(--ink-dim)', fontSize: '0.72rem', marginTop: '2rem', letterSpacing: '0.04em' }}>
          Use checkboxes to multi-select newsletters, then export a full media list CSV
        </p>
      </div>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function DossierPanel({ analysis: a, isFav, onToggleFav, copiedUrl, onCopy }) {
  return (
    <div style={{ padding: '1.25rem', overflowY: 'auto', maxHeight: 'calc(100vh - 200px)' }} className="scroll-thin">

      {/* Name + actions */}
      <div style={{ marginBottom: '1.25rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem' }}>
          <h2 className="font-display" style={{ margin: 0, fontSize: '1.4rem', lineHeight: 1.2, color: 'var(--ink)', fontWeight: 400, flex: 1 }}>{a.name}</h2>
          <IconBtn onClick={onToggleFav} title={isFav ? 'Unsave' : 'Save'}>
            {isFav ? <Star size={15} style={{ color: 'var(--accent)', fill: 'var(--accent)' }} /> : <StarOff size={15} style={{ color: 'var(--ink-dim)' }} />}
          </IconBtn>
        </div>
        <a href={a.url} target="_blank" rel="noopener noreferrer"
          style={{ color: 'var(--ink-dim)', fontSize: '0.72rem', textDecoration: 'none', display: 'block', marginTop: 4, wordBreak: 'break-all' }}
          onMouseEnter={(e) => e.target.style.color = 'var(--accent)'}
          onMouseLeave={(e) => e.target.style.color = 'var(--ink-dim)'}
        >{a.url}</a>

        {/* Categories + meta chips */}
        {(a.categories?.length > 0 || a.frequency || a.language) && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem', marginTop: '0.6rem' }}>
            {a.categories?.map((cat) => (
              <span key={cat} style={{ background: 'var(--purple)', color: '#4B3070', fontSize: '0.65rem', fontWeight: 600, padding: '0.15rem 0.55rem', borderRadius: 100 }}>{cat}</span>
            ))}
            {a.frequency && <span style={{ background: 'var(--surface-3)', color: 'var(--ink-mid)', fontSize: '0.65rem', padding: '0.15rem 0.55rem', borderRadius: 100 }}>📅 {a.frequency}</span>}
            {a.language  && <span style={{ background: 'var(--surface-3)', color: 'var(--ink-mid)', fontSize: '0.65rem', padding: '0.15rem 0.55rem', borderRadius: 100 }}>🌐 {a.language}</span>}
          </div>
        )}
      </div>

      {/* Divider */}
      <hr className="hairline" style={{ marginBottom: '1.25rem' }} />

      {/* Theme */}
      <BriefSection label="Theme">
        <p style={{ margin: 0, color: 'var(--ink-mid)', fontSize: '0.82rem', lineHeight: 1.6 }}>{a.theme}</p>
      </BriefSection>

      {/* Metrics row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '1rem' }}>
        <MetricCell icon={<Users size={12} />} label="Reach" value={a.reach} />
        <MetricCell icon={<MessageSquare size={12} />} label="Engagement" value={a.engagement} sub={a.engagement_score ? `${a.engagement_score}/10` : null} />
      </div>

      <BriefSection label="Location" icon={<MapPin size={11} />}>
        <p style={{ margin: 0, color: 'var(--ink-mid)', fontSize: '0.82rem' }}>{a.location}</p>
      </BriefSection>

      <BriefSection label="Contact" icon={<Mail size={11} />}>
        {a.contact?.includes('@')
          ? <a href={`mailto:${a.contact}`} style={{ color: 'var(--accent)', fontSize: '0.82rem', textDecoration: 'none', wordBreak: 'break-all' }}>{a.contact}</a>
          : a.contact?.startsWith('http')
            ? <a href={a.contact} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)', fontSize: '0.82rem', textDecoration: 'none' }}>Contact form / page →</a>
            : <p style={{ margin: 0, color: 'var(--ink-mid)', fontSize: '0.82rem' }}>{a.contact}</p>
        }
      </BriefSection>

      <BriefSection label="PR Insights" icon={<Briefcase size={11} />} extra={
        a.muckrack_url && a.muckrack_url !== 'Not found'
          ? <a href={a.muckrack_url} target="_blank" rel="noopener noreferrer"
              style={{ fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--accent)', textDecoration: 'none', background: 'var(--surface-3)', padding: '0.2rem 0.55rem', borderRadius: 4 }}>
              Muck Rack →
            </a>
          : null
      }>
        <p style={{ margin: 0, color: 'var(--ink-mid)', fontSize: '0.82rem', lineHeight: 1.65 }}>{a.pr_insights}</p>
      </BriefSection>

      <BriefSection label="Publishing Insight" icon={<DollarSign size={11} />}>
        <p style={{ margin: 0, color: 'var(--ink-mid)', fontSize: '0.82rem', lineHeight: 1.65 }}>{a.publishing_insights}</p>
      </BriefSection>

      {/* Copy URL */}
      <button onClick={() => onCopy(a.url)}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem', width: '100%', padding: '0.6rem', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--ink-dim)', cursor: 'pointer', fontSize: '0.75rem', fontFamily: 'inherit', marginTop: '0.5rem', transition: 'border-color 0.15s' }}
        onMouseEnter={(e) => e.currentTarget.style.borderColor = 'var(--accent)'}
        onMouseLeave={(e) => e.currentTarget.style.borderColor = 'var(--border)'}
      >
        {copiedUrl === a.url ? <><Check size={13} style={{ color: 'var(--accent)' }} /> Copied!</> : <><Copy size={13} /> Copy URL</>}
      </button>
    </div>
  );
}

function BriefSection({ label, icon, extra, children }) {
  return (
    <div style={{ marginBottom: '1rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.4rem' }}>
        <span className="label" style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', color: 'var(--ink-dim)' }}>
          {icon}{label}
        </span>
        {extra}
      </div>
      {children}
    </div>
  );
}

function MetricCell({ icon, label, value, sub }) {
  return (
    <div style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 6, padding: '0.6rem 0.75rem' }}>
      <span className="label" style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', color: 'var(--ink-dim)', marginBottom: 4 }}>{icon}{label}</span>
      <span style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--ink)' }}>{value}</span>
      {sub && <span style={{ fontSize: '0.7rem', color: 'var(--ink-dim)', marginLeft: 4 }}>({sub})</span>}
    </div>
  );
}

function StatCell({ label, value }) {
  return (
    <div>
      <span className="label" style={{ display: 'block', marginBottom: 4, color: 'var(--ink-dim)' }}>{label}</span>
      <span style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--accent)' }}>{value}</span>
    </div>
  );
}

function IconBtn({ onClick, title, children }) {
  return (
    <button onClick={onClick} title={title}
      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0.2rem', display: 'flex', alignItems: 'center', borderRadius: 4, transition: 'background 0.1s' }}
      onMouseEnter={(e) => e.currentTarget.style.background = 'var(--surface-3)'}
      onMouseLeave={(e) => e.currentTarget.style.background = 'none'}
    >{children}</button>
  );
}

function EmptyState({ icon: Icon, text, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '5rem 2rem', textAlign: 'center', opacity: 0.5 }}>
      <Icon size={28} style={{ color: 'var(--ink-dim)', marginBottom: '0.75rem' }} />
      <p style={{ margin: 0, color: 'var(--ink-dim)', fontSize: '0.85rem' }}>{text}</p>
      {children}
    </div>
  );
}

function DossierSelect({ value, onChange, options, prefix }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}
      style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 5, padding: '0.3rem 0.6rem', color: 'var(--ink-mid)', fontSize: '0.72rem', fontFamily: 'inherit', outline: 'none', cursor: 'pointer', appearance: 'none' }}>
      {options.map(([v, l]) => <option key={v} value={v}>{prefix ? `${prefix} ${l}` : l}</option>)}
    </select>
  );
}
