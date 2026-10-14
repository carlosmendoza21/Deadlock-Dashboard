import { useEffect, useState, type FormEvent } from 'react';
import { api, parseAccountId, vanityFromUrl } from './api';
import { useAsync } from './hooks';
import { PlayerPage } from './components/PlayerPage';
import { LiveMatchesPage } from './components/LiveMatchesPage';
import { MatchPage } from './components/MatchPage';

type Route =
  | { page: 'home' }
  | { page: 'search'; q: string }
  | { page: 'player'; id: number }
  | { page: 'match'; id: number }
  | { page: 'live' };

function parseRoute(hash: string): Route {
  const [, page, arg] = hash.replace(/^#/, '').split('/');
  if (page === 'player' && Number(arg)) return { page: 'player', id: Number(arg) };
  if (page === 'match' && Number(arg)) return { page: 'match', id: Number(arg) };
  if (page === 'search' && arg) return { page: 'search', q: decodeURIComponent(arg) };
  if (page === 'live') return { page: 'live' };
  return { page: 'home' };
}

export const go = (path: string) => { window.location.hash = path; };

export function App() {
  const [route, setRoute] = useState(() => parseRoute(location.hash));
  useEffect(() => {
    const onHash = () => { setRoute(parseRoute(location.hash)); window.scrollTo(0, 0); };
    addEventListener('hashchange', onHash);
    return () => removeEventListener('hashchange', onHash);
  }, []);

  return (
    <>
      <header className="topbar">
        <a className="brand" href="#/">
          <span className="brand-mark" aria-hidden>◆</span> Deadlock Live Odds
        </a>
        <nav>
          <a href="#/" className={route.page === 'home' || route.page === 'search' || route.page === 'player' ? 'active' : ''}>Find player</a>
          <a href="#/live" className={route.page === 'live' || route.page === 'match' ? 'active' : ''}>Live matches</a>
        </nav>
        {route.page !== 'home' && <SearchBox compact />}
      </header>
      <main>
        {route.page === 'home' && <Home />}
        {route.page === 'search' && <SearchResults q={route.q} />}
        {route.page === 'player' && <PlayerPage key={route.id} accountId={route.id} />}
        {route.page === 'match' && <MatchPage key={route.id} matchId={route.id} />}
        {route.page === 'live' && <LiveMatchesPage />}
      </main>
      <footer>
        Data from the community <a href="https://deadlock-api.com" target="_blank" rel="noreferrer">Deadlock API</a>.
        Not affiliated with Valve.
      </footer>
    </>
  );
}

function SearchBox({ compact }: { compact?: boolean }) {
  const [value, setValue] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const v = value.trim();
    if (!v) return;
    const id = parseAccountId(v);
    go(id != null ? `/player/${id}` : `/search/${encodeURIComponent(vanityFromUrl(v) ?? v)}`);
    setValue('');
  };
  return (
    <form className={`search ${compact ? 'compact' : ''}`} onSubmit={submit} role="search">
      <input
        value={value}
        onChange={e => setValue(e.target.value)}
        placeholder={compact ? 'Steam name or ID' : 'Steam name, profile URL, SteamID64 or account ID'}
        aria-label="Find a player"
      />
      <button type="submit">Search</button>
    </form>
  );
}

function Home() {
  return (
    <section className="home">
      <h1>What are your odds right now?</h1>
      <p className="lede">
        Look up a player to see the Ranked or Standard match they're in, with a live chance-to-win
        that updates as souls and objectives change.
      </p>
      <SearchBox />
      <div className="home-grid">
        <div className="card">
          <h3>How the odds work</h3>
          <p>
            Before the match, the estimate uses the rank gap between teams and how strong each hero lineup
            is right now. As the match goes on, it relies more on the souls lead and objectives taken.
            The model was trained on tens of thousands of recent matches.
          </p>
        </div>
        <div className="card">
          <h3>Can't find your match?</h3>
          <p>
            Live data comes from the in-game <b>Watch</b> tab, which only lists the top few hundred spectatable
            matches. Higher-rated games appear far more often. You can always{' '}
            <a href="#/live">browse every match that's live right now</a>.
          </p>
        </div>
      </div>
    </section>
  );
}

function SearchResults({ q }: { q: string }) {
  const { data, error, loading } = useAsync(() => api.steamSearch(q), [q]);
  return (
    <section className="page">
      <h2>Players matching “{q}”</h2>
      {loading && <p className="muted">Searching…</p>}
      {error && <p className="error">{error.message}</p>}
      {data && data.length === 0 && (
        <p className="muted">No Deadlock players found. Try a Steam profile URL or SteamID64 instead.</p>
      )}
      <ul className="results">
        {data?.map(p => (
          <li key={p.account_id}>
            <a href={`#/player/${p.account_id}`}>
              <img src={p.profileurl} alt="" width={40} height={40} />
              <span>
                <b>{p.username}</b>
                <span className="muted small">ID {p.account_id}</span>
              </span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
