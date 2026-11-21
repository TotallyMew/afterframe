import { useEffect, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { legacyHref, type MediaType } from './catalog';
import { Catalogue } from './Catalogue';
import { ComicDetailsPage, ComicsPage } from './Comics';
import { Header } from './components';
import { DetailsPage } from './Details';
import { AnimePage, RecommendationsPage } from './Discovery';
import { Home } from './Home';
import { LibraryPage } from './LibraryPage';
import { useLibrary } from './library';
import './styles.css';

const routeSnapshot = () => window.location.hash.replace(/^#\/?/, '') || 'home';
function subscribeRoute(notify: () => void) {
  window.addEventListener('hashchange', notify);
  return () => window.removeEventListener('hashchange', notify);
}

function App() {
  const route = useSyncExternalStore(subscribeRoute, routeSnapshot);
  const [path, query = ''] = route.split('?', 2);
  const title = path.match(/^(movie|tv)\/([1-9]\d{0,9})$/);
  const comic = path.match(/^comic\/([\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12})$/i);
  const home = path === 'home' || path === 'main';
  const catalogue = ['movies', 'tv', 'new'].includes(path) || path.startsWith('search=');
  const library = ['watchlist', 'watched', 'ratings', 'reading', 'history', 'notifications'].includes(path);
  const controls = useLibrary();
  const supported = home || Boolean(title || comic) || catalogue || library || ['anime', 'comics', 'recommendations'].includes(path);
  useEffect(() => {
    if (!supported) { window.location.replace(legacyHref(route)); return; }
    if (path !== 'main') window.scrollTo(0, 0);
  }, [route, path, supported]);

  let page = <p className="af-wrap af-state" role="status">Opening {path.split('/')[0]}…</p>;
  if (home) page = <Home controls={controls} />;
  else if (title) page = <DetailsPage key={path} type={title[1] as MediaType} id={Number(title[2])} controls={controls} />;
  else if (catalogue) page = <Catalogue key={route} route={route} controls={controls} />;
  else if (path === 'anime') page = <AnimePage key={route} query={query} />;
  else if (path === 'comics') page = <ComicsPage key={route} query={query} controls={controls} />;
  else if (comic) page = <ComicDetailsPage key={route} id={comic[1]} query={query} controls={controls} />;
  else if (path === 'recommendations') page = <RecommendationsPage controls={controls} />;
  else if (library) page = <LibraryPage key={path} path={path} controls={controls} />;

  return <div className="af-app" data-page={home ? 'home' : title ? 'title' : 'directory'}>
    <a href="#main" className="af-skip" onClick={event => { event.preventDefault(); document.getElementById('main')?.focus(); }}>Skip to content</a>
    <Header controls={controls} route={route} />
    {controls.error && <div className="af-notice" role="alert">{controls.error} <button className="af-text-link" type="button" onClick={() => void controls.refresh()}>Reload library</button></div>}
    <main id="main" tabIndex={-1}>
      {page}
    </main>
  </div>;
}

const root = document.getElementById('root');
if (!root) throw new Error('Afterframe could not find its root element.');
createRoot(root).render(<App />);
