# Afterframe

Afterframe is a personal media library that runs on localhost. Browse trending titles, new movies and series, anime, and comics, or search for a specific title. The video catalog supports genre, release year, IMDb rating, and runtime filters. The IMDb filter checks scores as each page loads.

Movies and shows have dedicated records with artwork, cast and crew, ratings, related titles, and episode lists. Local profiles keep separate watchlists, watched titles and episodes, personal ratings, playback history, and preferences. Guest activity and preferences are saved in the browser.

## Run locally

Install Node.js 22.19 or newer, then run these commands from the repository root.

```sh
cd afterframe
npm ci
npm start
```

Open [localhost:4173](http://localhost:4173/). The server listens on the loopback interface. Set `PORT` in the environment or in `afterframe/.env` to choose another port.

Run the automated tests with `npm test` from the `afterframe` directory.

## React preview

Home, search suggestions, and movie and series Details are available in a separate React frontend. The video player and other screens open under `/legacy/` on the same origin, so both interfaces share the same session and guest library.

Start the existing API from `afterframe` with `npm start`. In another terminal, run:

```sh
cd apps/web
npm ci
npm run dev
```

Open [localhost:5174](http://localhost:5174/). Set `AFTERFRAME_API_URL` before starting Vite if the API uses a port other than 4173. Run `npm run build` in `apps/web` to type-check and build the frontend. If `apps/web/dist/index.html` exists when Node starts, the React build opens on the API server's main address and the classic interface remains at `/legacy/`. Use `AFTERFRAME_WEB_DIST` to select a different build directory.

## Library, search and releases

- **My Library** includes title search, watch statuses, progress and rating filters, and a session history. Register or sign in to keep these records on the server and resume on another browser connected to the same installation. Existing five-star ratings are doubled once to preserve their relative scores on the 1–10 scale.
- **Recommendations** start with discovery picks. Completing two distinct series or meaningfully watching three titles or episodes enables personalized recommendations. **Anime** supports season, year, format, status, genre, theme and episode count filters.
- **My Library → Notifications** shows newly aired episodes and season premieres detected from TMDb's last-aired episode data. Afterframe checks followed series in the background and records a baseline on the first check. Configure notification types under **Settings → General**.
- To publish verified season announcements, point `AFTERFRAME_ANNOUNCEMENTS_FILE` to a JSON file containing an array of objects with `seriesId` (TMDb), `season`, and `source` (an HTTPS link from the publisher or broadcaster). Add an entry only after confirming the announcement. Afterframe includes the source link in the notification and deduplicates by series and season.

## Run behind an HTTPS reverse proxy

Afterframe listens on loopback. For a public installation, terminate HTTPS at a reverse proxy on the same host, forward the configured public hostname as `Host`, and set `AFTERFRAME_ORIGIN` to that HTTPS origin. For example, with a proxy at `https://afterframe.example.com` forwarding to `127.0.0.1:4173`, set `AFTERFRAME_ORIGIN=https://afterframe.example.com`. Supply service credentials in the server environment. Published installations manage integration credentials exclusively on the server.

Set `AFTERFRAME_REGISTRATION=closed` to restrict registration after creating your accounts. From the account dialog, generate a one-time recovery code and save it in a password manager. Resetting the password with the code signs out all existing sessions. The account dialog also lets you sign out other devices while keeping the current session.

Point availability checks at `GET /api/health`. In HTTPS mode, API request logs include a request ID, path, status, and duration. Query strings, request bodies, and cookies are omitted.

## Configure the catalog

- **TMDb** supplies the full movie and TV catalog. Open **Settings → API Keys / Integrations** and save your API Read Access Token or v3 API key. [Get a TMDb key](https://www.themoviedb.org/settings/api)
- **OMDb** is optional and supplies IMDb scores and vote counts. Save your OMDb API key in the same section. [Get an OMDb key](https://www.omdbapi.com/apikey.aspx)
- **MyAnimeList** supplies anime and manga scores for titles with a verified MAL mapping. Set `MAL_CLIENT_ID` in `afterframe/.env` with a Client ID from your registered MyAnimeList application. [MyAnimeList API](https://myanimelist.net/apiconfig)
- **PostgreSQL** is optional. Set `DATABASE_URL` in `afterframe/.env` to persist the metadata cache. Afterframe creates its cache table on first use and periodically refreshes recently expired records. It also reads `afterframe/data/metadata-pg.env` when present. Without PostgreSQL, metadata is cached in memory.

API keys saved in Settings survive restarts and apply to all local profiles. They take precedence over `TMDB_READ_TOKEN`, `TMDB_API_KEY`, and `OMDB_API_KEY` in `afterframe/.env`. Accounts, API keys, personal ratings, and viewing history are stored in `afterframe/data/accounts.sqlite`. Git ignores the environment files and data directory.

Afterframe uses Inter for interface text and Instrument Sans for display text. The display font stack also accepts Founders Grotesk when it is available in the browser.

## Playback

Select **Watch now** on a movie or choose an episode from its season. Playback for TMDb catalog titles depends on [CineSrc](https://cinesrc.st/docs) having a working source. Selected public-domain and Creative Commons editions are available through the Internet Archive or Wikimedia Commons.

Afterframe uses [AniBridge episode mappings](https://github.com/anibridge/anibridge-mappings) to translate TMDb seasons and episode numbers to AniList. [AnimeEmbed](https://animeembed.com/) plays mapped episodes inside Afterframe when a stream is available. The player can switch to [Ani.pm](https://ani.pm/developers) and CineSrc. Third-party players manage their own audio and subtitle controls and may show ads.

Afterframe saves the position and ranges you watched per movie or episode. Once you've watched enough of a title to complete it, it leaves **Continue Watching** and stays in **My Library → Watched**. Use the previous and next buttons beside Play or choose an episode from the list below the player. Long seasons have an **Episode range** picker. Upcoming episodes show the scheduled date when TMDb provides one.

The Afterframe player uses bundled or [TheIntroDB](https://theintrodb.org/) timings for intros, recaps, and credits. With auto-next enabled, a cancellable 10-second countdown begins at matched credits or at playback end when credits timings are unavailable. Use **Cancel** to stay for an extra scene, or **Skip credits** to open the next episode immediately. Fullscreen stays active when the Afterframe player switches episodes. Native video shows actual buffered ranges behind the current playback position on the seek bar.

For CineSrc titles in the Afterframe player, the captions button uses the OpenSubtitles catalog with a secondary source. Changes in **Settings → General** apply during playback and carry over between episodes when **Remember subtitles** is enabled. Embedded players have their own caption controls when using the provider's interface. The loaded-range indicator is available when Afterframe can read the video element's actual buffer. **Video sources** opens CineSrc's server controls. **Use Afterframe controls** returns to the Afterframe interface at the current playback position.

Press **/** to search or **Ctrl+K / ⌘K** for quick navigation. Click the video picture to play or pause, or double-click it to toggle fullscreen. With the watch page focused, use **Space** to play or pause, **← / →** to seek, **F** for fullscreen, and **S** to skip an available segment. On touch devices, tap the picture to reveal the controls.

## Comics

Open **Comics** to browse manga, manhwa, manhua, and other comics from [MangaDex](https://mangadex.org/). Use the format tabs, genre and publication filters, or the search box. Browse and search include titles before they have chapters available in the reader. The **Recently updated** shelf highlights recently added English MangaDex chapters. The catalog uses MangaDex's safe and suggestive content ratings.

Choose a chapter language to see chapters that open in the built-in reader. Afterframe checks [Weeb Central](https://weebcentral.com/) and [Manga Scans](https://manga-scans.com/) for English chapters and [Lector Manga](https://lector-mangas.lat/) for Spanish chapters. The lookup tries alternate titles and combines chapter lists even when MangaDex already has some chapters. MangaDex releases appear first for each chapter. Coverage depends on matching editions and available pages. Chapter ranges and previous or next chapter links help you navigate longer series.

The reader offers single-page and vertical-scroll layouts, page fit controls, and fullscreen. Use the page picker or **← / →** in single-page mode, and press **F** for fullscreen. Afterframe remembers your layout and fit on this browser.

**My Library → Reading** shows your reading list and your last page for each title. Guest activity stays in the browser, and signed-in progress belongs to the local account. Comics use MangaDex's public API without an API key. Chapter coverage varies by title and language.

Afterframe credits MangaDex and the scanlation groups listed on each chapter. Set `MANGADEX_BLOCKED_GROUPS` in `afterframe/.env` to the comma-separated group IDs to exclude from chapter lists and the reader in response to [MangaDex group removal requests](https://gitlab.com/mangadex-pub/mangadex-api-docs/-/blob/main/index.md).
