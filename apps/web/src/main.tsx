import { useEffect, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { legacyHref, type MediaType } from './catalog';
import { Header } from './components';
import { DetailsPage } from './Details';
import { Home } from './Home';
import { useLibrary } from './library';
import './styles.css';

const routeSnapshot = () => window.location.hash.replace(/^#\/?/, '') || 'home';
function subscribeRoute(notify: () => void) {
  window.addEventListener('hashchange', notify);
  return () => window.removeEventListener('hashchange', notify);
}

function App() {
  const route = useSyncExternalStore(subscribeRoute, routeSnapshot);
  const title = route.match(/^(movie|tv)\/([1-9]\d{0,9})$/);
  const home = route === 'home' || route === 'main';
  const controls = useLibrary();
  useEffect(() => {
    if (!home && !title) { window.location.replace(legacyHref(route)); return; }
    if (route !== 'main') window.scrollTo(0, 0);
  }, [route, home, Boolean(title)]);

  return <div className="af-app" data-page={home ? 'home' : 'title'}>
    <a href="#main" className="af-skip" onClick={event => { event.preventDefault(); document.getElementById('main')?.focus(); }}>Skip to content</a>
    <Header controls={controls} route={route} />
    {controls.error && <div className="af-notice" role="alert">{controls.error} <button className="af-text-link" type="button" onClick={() => void controls.refresh()}>Reload library</button></div>}
    <main id="main" tabIndex={-1}>
      {home ? <Home controls={controls} /> : title ? <DetailsPage key={route} type={title[1] as MediaType} id={Number(title[2])} controls={controls} />
        : <p className="af-wrap af-state" role="status">Opening {route.split('/')[0]}…</p>}
    </main>
  </div>;
}

const root = document.getElementById('root');
if (!root) throw new Error('Afterframe could not find its root element.');
createRoot(root).render(<App />);
