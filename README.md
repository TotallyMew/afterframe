# Afterframe

Afterframe is a personal film archive that runs on localhost. Browse a featured film, trending titles, new releases, top films on TMDb, and anime, or search for a specific movie or series. The catalog supports genre, release year, IMDb rating, and runtime filters. The IMDb filter checks scores as each page loads. TMDb determines the top-rated ranking, and title cards display IMDb scores from OMDb.

Movies and shows have dedicated records with artwork, cast and crew, ratings, related titles, and episode lists. Local profiles keep separate watchlists, watched titles and episodes, personal ratings, playback history, and preferences. Guest activity and preferences are saved in the browser.

## Run locally

Install Node.js 22.19 or newer, then run these commands from the repository root.

```sh
cd afterframe
npm ci
npm start
```

Open [localhost:4173](http://localhost:4173/). The server listens on the loopback interface. Set `PORT` in the environment or in `afterframe/.env` to choose another port.

## Configure the catalog

- **TMDb** supplies the full movie and TV catalog. Open **Settings → API keys** and save your API Read Access Token or v3 API key. [Get a TMDb key](https://www.themoviedb.org/settings/api)
- **OMDb** is optional and supplies IMDb scores and vote counts. Save your OMDb API key in the same section. [Get an OMDb key](https://www.omdbapi.com/apikey.aspx)
- **PostgreSQL** is optional. Set `DATABASE_URL` in `afterframe/.env` to persist the metadata cache. Afterframe creates its cache table on first use and periodically refreshes recently expired records. It also reads `afterframe/data/metadata-pg.env` when present. Without PostgreSQL, metadata is cached in memory.

API keys saved in Settings survive restarts and apply to all local profiles. They take precedence over `TMDB_READ_TOKEN`, `TMDB_API_KEY`, and `OMDB_API_KEY` in `afterframe/.env`. Accounts, API keys, personal ratings, and viewing history are stored in `afterframe/data/accounts.sqlite`. Git ignores the environment files and data directory.

Afterframe uses Inter for interface text and Instrument Sans for display text. The display font stack also accepts Founders Grotesk when it is available in the browser.

## Playback

Select **Watch now** on a movie or choose an episode from its season. Playback for TMDb catalog titles depends on [CineSrc](https://cinesrc.st/docs) having a working source. Selected public-domain and Creative Commons editions are available through the Internet Archive or Wikimedia Commons.

Afterframe saves the position and ranges you watched per movie or episode. Once you've watched enough of a title to complete it, it leaves **Continue Watching** and stays in **My Library → Watched**. CineSrc episodes use the embedded episode menu and next-episode prompt. Afterframe updates the episode in place when CineSrc advances, and reconnects the same frame if the playback API stops reporting the new episode. Direct streams use the Afterframe player's episode buttons and cancellable 10-second countdown.

The Afterframe player uses bundled or [TheIntroDB](https://theintrodb.org/) timings to show and skip known intros, recaps, and credits. Gaps between credits segments are preserved for mid-credit and post-credit scenes. For CineSrc episodes, Afterframe passes the auto-next setting and enables CineSrc's combined intro and recap skip when both options are on. CineSrc manages its subtitle, quality, and source menus and accepts a preferred starting quality. Changes to CineSrc auto-next and auto-skip apply when the player is opened again.

Press **/** to search or **Ctrl+K / ⌘K** for quick navigation. Click the video picture to play or pause, or double-click it to toggle fullscreen. With the watch page focused, use **Space** to play or pause, **← / →** to seek, **F** for fullscreen, and **S** to skip an available segment. On touch devices, CineSrc handles its own gestures.
