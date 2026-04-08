import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Search, ExternalLink, Star, Clock, Tag, Loader2, X, BookOpen, AlertCircle } from 'lucide-react';

// ─── Local Storage Helpers ────────────────────────────────────────────────────

const FAVORITES_KEY = 'brouser_favorites_v2';
const HISTORY_KEY = 'brouser_history_v2';
const CACHE_KEY = 'brouser_cache_v2';
const CACHE_TTL = 1000 * 60 * 60; // 1 hour

const storage = {
  get: (key, fallback) => {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
    catch { return fallback; }
  },
  set: (key, value) => {
    try { localStorage.setItem(key, JSON.stringify(value)); }
    catch { /* quota exceeded, ignore */ }
  },
};

const getCache = (query) => {
  const cache = storage.get(CACHE_KEY, {});
  const entry = cache[query];
  if (entry && Date.now() - entry.ts < CACHE_TTL) return entry.data;
  return null;
};

const setCache = (query, data) => {
  const cache = storage.get(CACHE_KEY, {});
  cache[query] = { data, ts: Date.now() };
  // Keep cache lean — max 20 entries
  const keys = Object.keys(cache);
  if (keys.length > 20) delete cache[keys[0]];
  storage.set(CACHE_KEY, cache);
};

// ─── Suggested Searches ───────────────────────────────────────────────────────

const SUGGESTIONS = [
  'food writing', 'climate tech', 'personal finance',
  'travel', 'book reviews', 'startup culture',
  'mental health', 'film criticism', 'fashion',
  'local journalism', 'crypto & web3', 'parenting',
];

// ─── Components ───────────────────────────────────────────────────────────────

function TagPill({ label }) {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-brand-purple text-brand-green">
      <Tag size={10} />
      {label}
    </span>
  );
}

function NewsletterCard({ newsletter, isFavorite, onToggleFavorite }) {
  const { name, author, description, url, frequency, tags } = newsletter;
  const domain = (() => {
    try { return new URL(url).hostname; } catch { return url; }
  })();

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition-shadow duration-200 flex flex-col">
      {/* Card header */}
      <div className="p-5 flex-1">
        <div className="flex items-start justify-between gap-3 mb-2">
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-brand-green text-base leading-snug truncate">
              {name}
            </h3>
            {author && (
              <p className="text-sm text-gray-500 mt-0.5">by {author}</p>
            )}
          </div>
          <button
            onClick={() => onToggleFavorite(newsletter)}
            className="shrink-0 p-1.5 rounded-full hover:bg-brand-cream transition-colors"
            aria-label={isFavorite ? 'Remove from favorites' : 'Save to favorites'}
          >
            <Star
              size={16}
              className={isFavorite ? 'fill-brand-chartreuse text-brand-green' : 'text-gray-300'}
            />
          </button>
        </div>

        {description && (
          <p className="text-sm text-gray-600 leading-relaxed line-clamp-3 mt-2">
            {description}
          </p>
        )}

        {tags?.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-3">
            {tags.slice(0, 4).map((tag) => (
              <TagPill key={tag} label={tag} />
            ))}
          </div>
        )}
      </div>

      {/* Card footer */}
      <div className="px-5 py-3 border-t border-gray-50 flex items-center justify-between gap-3">
        {frequency && (
          <span className="flex items-center gap-1 text-xs text-gray-400">
            <Clock size={11} />
            {frequency}
          </span>
        )}
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto flex items-center gap-1.5 text-xs font-medium text-brand-green hover:text-brand-chartreuse bg-brand-chartreuse hover:bg-brand-green px-3 py-1.5 rounded-full transition-colors duration-150"
        >
          {domain}
          <ExternalLink size={11} />
        </a>
      </div>
    </div>
  );
}

function EmptyState({ onSuggest }) {
  return (
    <div className="text-center py-16 px-4">
      <div className="w-14 h-14 bg-brand-chartreuse rounded-2xl flex items-center justify-center mx-auto mb-4">
        <BookOpen size={28} className="text-brand-green" />
      </div>
      <h2 className="text-xl font-semibold text-brand-green mb-2">
        Find newsletters your clients will love
      </h2>
      <p className="text-gray-500 mb-8 max-w-sm mx-auto text-sm">
        Search any topic to discover active Substack newsletters — perfect for pitching clients to the right writers.
      </p>
      <div className="flex flex-wrap justify-center gap-2 max-w-lg mx-auto">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            onClick={() => onSuggest(s)}
            className="px-4 py-2 rounded-full text-sm border border-brand-green/20 text-brand-green hover:bg-brand-green hover:text-brand-chartreuse transition-colors duration-150"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

function FavoritesPanel({ favorites, onRemove, onClose }) {
  if (!favorites.length) return null;
  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold text-brand-green flex items-center gap-2">
          <Star size={15} className="fill-brand-chartreuse text-brand-green" />
          Saved ({favorites.length})
        </h2>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
          <X size={16} />
        </button>
      </div>
      <ul className="space-y-2">
        {favorites.map((n) => (
          <li key={n.url} className="flex items-center justify-between gap-2 text-sm">
            <a
              href={n.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-brand-green hover:underline truncate"
            >
              {n.name}
            </a>
            <button
              onClick={() => onRemove(n)}
              className="shrink-0 text-gray-300 hover:text-red-400 transition-colors"
              aria-label="Remove"
            >
              <X size={13} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────

export default function App() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [hasSearched, setHasSearched] = useState(false);

  const [favorites, setFavorites] = useState(() => storage.get(FAVORITES_KEY, []));
  const [history, setHistory] = useState(() => storage.get(HISTORY_KEY, []));
  const [showFavorites, setShowFavorites] = useState(false);

  const inputRef = useRef(null);

  // Persist favorites and history
  useEffect(() => { storage.set(FAVORITES_KEY, favorites); }, [favorites]);
  useEffect(() => { storage.set(HISTORY_KEY, history); }, [history]);

  const isFavorite = useCallback(
    (url) => favorites.some((f) => f.url === url),
    [favorites]
  );

  const toggleFavorite = useCallback((newsletter) => {
    setFavorites((prev) =>
      prev.some((f) => f.url === newsletter.url)
        ? prev.filter((f) => f.url !== newsletter.url)
        : [newsletter, ...prev]
    );
  }, []);

  const removeFavorite = useCallback((newsletter) => {
    setFavorites((prev) => prev.filter((f) => f.url !== newsletter.url));
  }, []);

  const addHistory = useCallback((term) => {
    setHistory((prev) => [term, ...prev.filter((t) => t !== term)].slice(0, 8));
  }, []);

  const handleSearch = useCallback(async (searchQuery) => {
    const q = (searchQuery || query).trim();
    if (!q) return;

    // Check cache
    const cached = getCache(q);
    if (cached) {
      setResults(cached);
      setHasSearched(true);
      setQuery(q);
      addHistory(q);
      return;
    }

    setLoading(true);
    setError(null);
    setResults([]);
    setHasSearched(true);
    setQuery(q);
    addHistory(q);

    try {
      const res = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Search failed. Please try again.');
      }

      const newsletters = data.newsletters || [];
      setResults(newsletters);
      setCache(q, newsletters);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [query, addHistory]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') handleSearch();
  };

  const handleSuggest = (suggestion) => {
    setQuery(suggestion);
    handleSearch(suggestion);
  };

  const clearSearch = () => {
    setQuery('');
    setResults([]);
    setError(null);
    setHasSearched(false);
    inputRef.current?.focus();
  };

  return (
    <div className="min-h-screen bg-brand-cream">
      {/* ── Header ── */}
      <header className="bg-brand-green text-white px-4 py-5">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold tracking-tight">
              The Brouser™
            </h1>
            <p className="text-brand-chartreuse text-xs mt-0.5 font-medium tracking-wide">
              by Brouhaha Collective
            </p>
          </div>
          {favorites.length > 0 && (
            <button
              onClick={() => setShowFavorites((v) => !v)}
              className="flex items-center gap-1.5 text-sm text-brand-chartreuse hover:opacity-80 transition-opacity"
            >
              <Star size={14} className="fill-brand-chartreuse" />
              {favorites.length} saved
            </button>
          )}
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8">

        {/* ── Favorites Panel ── */}
        {showFavorites && favorites.length > 0 && (
          <div className="mb-6">
            <FavoritesPanel
              favorites={favorites}
              onRemove={removeFavorite}
              onClose={() => setShowFavorites(false)}
            />
          </div>
        )}

        {/* ── Search Bar ── */}
        <div className="mb-6">
          {!hasSearched && (
            <p className="text-center text-brand-green font-medium text-lg mb-4">
              Discover Substack newsletters by topic
            </p>
          )}
          <div className="relative flex gap-2">
            <div className="relative flex-1">
              <Search
                size={18}
                className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
              />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Try 'food writing' or 'climate newsletters'…"
                className="w-full pl-11 pr-10 py-3.5 rounded-xl border border-gray-200 bg-white text-brand-green placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-green/30 focus:border-brand-green text-sm shadow-sm"
              />
              {query && (
                <button
                  onClick={clearSearch}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-500"
                >
                  <X size={16} />
                </button>
              )}
            </div>
            <button
              onClick={() => handleSearch()}
              disabled={loading || !query.trim()}
              className="px-5 py-3.5 bg-brand-green text-brand-chartreuse rounded-xl font-medium text-sm hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity shadow-sm shrink-0"
            >
              {loading ? <Loader2 size={18} className="animate-spin" /> : 'Search'}
            </button>
          </div>

          {/* Search History */}
          {history.length > 0 && !hasSearched && (
            <div className="flex flex-wrap gap-2 mt-3">
              <span className="text-xs text-gray-400 flex items-center gap-1">
                <Clock size={11} /> Recent:
              </span>
              {history.map((term) => (
                <button
                  key={term}
                  onClick={() => handleSuggest(term)}
                  className="text-xs text-gray-500 hover:text-brand-green hover:underline transition-colors"
                >
                  {term}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* ── Error ── */}
        {error && (
          <div className="flex items-start gap-3 bg-red-50 border border-red-100 text-red-700 rounded-xl px-4 py-3 mb-6 text-sm">
            <AlertCircle size={16} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* ── Loading ── */}
        {loading && (
          <div className="text-center py-20">
            <Loader2 size={32} className="animate-spin text-brand-green mx-auto mb-3" />
            <p className="text-sm text-gray-500">Searching for newsletters about <strong className="text-brand-green">"{query}"</strong>…</p>
          </div>
        )}

        {/* ── Results ── */}
        {!loading && results.length > 0 && (
          <>
            <p className="text-sm text-gray-500 mb-4">
              Found <strong className="text-brand-green">{results.length}</strong> newsletters about <strong className="text-brand-green">"{query}"</strong>
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {results.map((newsletter) => (
                <NewsletterCard
                  key={newsletter.url}
                  newsletter={newsletter}
                  isFavorite={isFavorite(newsletter.url)}
                  onToggleFavorite={toggleFavorite}
                />
              ))}
            </div>
          </>
        )}

        {/* ── No Results ── */}
        {!loading && hasSearched && results.length === 0 && !error && (
          <div className="text-center py-16">
            <p className="text-gray-500 mb-2">No newsletters found for <strong>"{query}"</strong>.</p>
            <p className="text-sm text-gray-400">Try a different topic or broader keyword.</p>
          </div>
        )}

        {/* ── Empty State ── */}
        {!hasSearched && !loading && (
          <EmptyState onSuggest={handleSuggest} />
        )}
      </main>

      {/* ── Footer ── */}
      <footer className="mt-16 pb-8 text-center text-xs text-gray-400">
        The Brouser™ — a Brouhaha Collective tool
      </footer>
    </div>
  );
}
