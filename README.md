# Afterframe

Afterframe is a personal movie and TV library that runs on localhost. Browse trending titles, new releases, top-rated films, hidden gems, and anime, or search for a specific movie or episode. Genre and decade filters help narrow the catalog.

Movies and shows have dedicated pages with artwork, cast, ratings, and episode lists. Local profiles keep separate watchlists, personal ratings, playback history, and skip timestamps. Guests can browse and play titles, with their library saved in the browser.

## Run locally

Install Node.js 22.19 or newer, then run these commands from the repository root.

```sh
cd afterframe
npm ci
npm start
```

Open [localhost:4173](http://localhost:4173/). The server listens on the loopback interface. Set `PORT` in the environment or in `afterframe/.env` to choose another port.

## Configure the catalog

- **TMDb** supplies titles, artwork, cast, release dates, external IMDb IDs, and regional JustWatch listings. Paste an [API Read Access Token](https://www.themoviedb.org/settings/api) into Settings, or set `TMDB_READ_TOKEN` or `TMDB_API_KEY` in `afterframe/.env` to persist the connection across restarts.
- **OMDb** optionally supplies IMDb scores and vote counts. Set `OMDB_API_KEY` in `afterframe/.env` to enable it. Cards use cached IMDb scores when available and show labeled TMDb scores otherwise.
- **PostgreSQL** is optional. Set `DATABASE_URL` in `afterframe/.env` to persist the metadata cache. Afterframe creates its cache table on first use and periodically refreshes recently expired records. It also reads `afterframe/data/metadata-pg.env` when present. Without PostgreSQL, metadata is cached in memory.

Accounts, personal ratings, and viewing history are stored in `afterframe/data/accounts.sqlite`. Environment files and the app's data directory are excluded from Git.

## Playback

Select **Watch now** on a movie or choose an episode from its season. Playback for TMDb catalog titles depends on [CineSrc](https://cinesrc.st/docs) having a working source. Selected public-domain and Creative Commons editions are available through the Internet Archive or Wikimedia Commons. To use a video from your computer, choose **Other ways to watch → Play local file**.

The player saves progress per movie and episode. It can mark intros, recaps, and credits using bundled timestamps, matching [TheIntroDB](https://theintrodb.org/) data, or times you enter in **Skip settings**. Enable automatic intro and recap skipping in Settings.

Press **/** to search or **Ctrl+K / ⌘K** for quick navigation. On the watch page, use **Space** to play or pause, **← / →** to seek, **F** for fullscreen, and **S** to skip an available segment.
