import { searchTracks } from "./api";
import { player } from "./player";
import { SCTrack } from "../types/soundcloud";
import { log, warn } from "./debug";
import {
  isTrackUnavailable,
  trackUnavailableLabel,
} from "./trackAvailability";

const SEL_SEARCH_PAGE = "#searchPage";
const SEL_TRACKS_SECTION = 'section[data-testid="search-tracks-result"]';
const SEL_TRACK_LIST_CONTAINER = ".main-trackList-trackListContainer";
const SC_GRID_ID = "sc-sp-grid";
const CLS_ROW = "sc-sp-row";
const CLS_SPOTIFY_BADGE = "wl-sp-spotify-source-badge";

let _results: SCTrack[] = [];
let _lastQuery = "";
let _pageObs: MutationObserver | null = null;
let _searchDebounce: ReturnType<typeof setTimeout> | null = null;
let _navDebounce: ReturnType<typeof setTimeout> | null = null;
let _pollInterval: ReturnType<typeof setInterval> | null = null;
let _historyUnlisten: (() => void) | null = null;
let _destroyed = false;
let _searchGeneration = 0;

// ── Helpers ───────────────────────────────────────────────────────────────────

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmt(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

const SC_SVG_SMALL =
  `<svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14" aria-hidden="true" style="flex-shrink:0">` +
  `<path d="M23.999 14.165c-.052 1.796-1.612 3.169-3.4 3.169h-8.18a.68.68 0 0 1-.675-.683V7.862a.747.747 0 0 1 .452-.724s.75-.513 2.333-.513a5.364 5.364 0 0 1 2.763.755 5.433 5.433 0 0 1 2.57 3.54c.282-.08.574-.121.868-.12.884 0 1.73.358 2.347.992s.948 1.49.922 2.373ZM10.721 8.421c.247 2.98.427 5.697 0 8.672a.264.264 0 0 1-.53 0c-.395-2.946-.22-5.718 0-8.672a.264.264 0 0 1 .53 0ZM9.072 9.448c.285 2.659.37 4.986-.006 7.655a.277.277 0 0 1-.55 0c-.331-2.63-.256-5.02 0-7.655a.277.277 0 0 1 .556 0Zm-1.663-.257c.27 2.726.39 5.171 0 7.904a.266.266 0 0 1-.532 0c-.38-2.69-.257-5.21 0-7.904a.266.266 0 0 1 .532 0Zm-1.647.77a26.108 26.108 0 0 1-.008 7.147.272.272 0 0 1-.542 0 27.955 27.955 0 0 1 0-7.147.275.275 0 0 1 .55 0Zm-1.67 1.769c.421 1.865.228 3.5-.029 5.388a.257.257 0 0 1-.514 0c-.21-1.858-.398-3.549 0-5.389a.272.272 0 0 1 .543 0Zm-1.655-.273c.388 1.897.26 3.508-.01 5.412-.026.28-.514.283-.54 0-.244-1.878-.347-3.54-.01-5.412a.283.283 0 0 1 .56 0Zm-1.668.911c.4 1.268.257 2.292-.026 3.572a.257.257 0 0 1-.514 0c-.241-1.262-.354-2.312-.023-3.572a.283.283 0 0 1 .563 0Z"/>` +
  `</svg>`;

const SPOTIFY_SVG_INLINE =
  `<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" ` +
  `style="display:inline-block;flex-shrink:0;vertical-align:middle;margin-right:3px">` +
  `<path fill="#1DB954" d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>` +
  `</svg>`;

const PLAY_ICON_SVG =
  `<svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18" aria-hidden="true">` +
  `<path d="m7.05 3.606 13.49 7.788a.7.7 0 0 1 0 1.212L7.05 20.394A.7.7 0 0 1 6 19.788V4.212a.7.7 0 0 1 1.05-.606"/>` +
  `</svg>`;

// ── CSS ───────────────────────────────────────────────────────────────────────

function injectStyles(): void {
  if (document.getElementById("sc-sp-styles")) return;
  const s = document.createElement("style");
  s.id = "sc-sp-styles";
  s.textContent = `
    /* Image + play-button container */
    .sc-sp-img-wrap {
      position: relative;
      flex-shrink: 0;
      display: inline-flex;
    }
    .sc-sp-img-wrap img {
      display: block;
      transition: filter 0.15s;
    }
    .sc-sp-row:hover .sc-sp-img-wrap img {
      filter: brightness(0.55);
    }
    .sc-sp-img-blank {
      width: 40px;
      height: 40px;
      background: var(--background-tinted-base, rgba(255,255,255,0.1));
      border-radius: var(--encore-corner-radius-base, 4px);
    }

    /* Play button — absolute over artwork */
    .sc-sp-play-btn {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      background: transparent;
      border: none;
      cursor: pointer;
      color: #fff;
      padding: 0;
      opacity: 0;
      transition: opacity 0.15s;
    }
    .sc-sp-row:hover .sc-sp-play-btn {
      opacity: 1;
    }

    /* Inline SC logo inside track title */
    .sc-sp-inline-icon {
      display: inline-flex;
      vertical-align: middle;
      color: #ff5500;
      margin-right: 3px;
      flex-shrink: 0;
    }
    .sc-sp-source { display:inline-flex; color:#ff5500; flex-shrink:0; }

    /* Spotify badge wrapper on native rows */
    [data-sc-sp-badge] .main-trackList-rowMainContentTitle {
      display: flex !important;
      align-items: center;
    }
    .sc-sp-availability {
      color: var(--text-subdued, #b3b3b3);
      font-size: var(--encore-text-size-smaller-2, 0.75rem);
      line-height: 1.35;
    }
    .sc-sp-row.is-unavailable {
      cursor: default;
    }
    .sc-sp-row.is-unavailable:hover {
      background: transparent !important;
    }
    .sc-sp-row.is-unavailable .sc-sp-img-wrap img {
      filter: grayscale(.35) brightness(.42);
    }
    .sc-sp-row.is-unavailable .main-trackList-rowMainContentTitle,
    .sc-sp-row.is-unavailable .main-trackList-rowMainContentSubTitle,
    .sc-sp-row.is-unavailable .main-trackList-duration,
    .sc-sp-row.is-unavailable .sc-sp-source {
      opacity: .48;
    }
    .sc-sp-row.is-unavailable .sc-sp-play-btn {
      display: none;
    }
  `;
  document.head.appendChild(s);
}

// ── Row builder ───────────────────────────────────────────────────────────────

function buildRow(track: SCTrack, idx: number): HTMLElement {
  const unavailable = isTrackUnavailable(track);
  const unavailableLabel = trackUnavailableLabel(track);
  const availabilityId = `wl-sc-sp-unavailable-${idx}`;
  const rowWrap = document.createElement("div");
  rowWrap.setAttribute("role", "row");
  rowWrap.setAttribute("aria-rowindex", String(idx + 1));
  rowWrap.setAttribute("aria-selected", "false");
  if (unavailable) rowWrap.setAttribute("aria-describedby", availabilityId);

  const row = document.createElement("div");
  row.className = `main-trackList-trackListRow main-trackList-trackListRowGrid ${CLS_ROW}${unavailable ? " is-unavailable" : ""}`;
  row.setAttribute("role", "presentation");
  if (!unavailable) row.setAttribute("tabindex", "0");
  row.style.cssText =
    "--grid-template-columns:[first] minmax(var(--first-min-width,180px),4fr) " +
    "[last] minmax(var(--last-min-width,120px),1fr);";

  // Left cell: artwork + play btn + title + artist
  const leftCell = document.createElement("div");
  leftCell.className = "main-trackList-rowSectionStart";
  leftCell.setAttribute("role", "gridcell");
  leftCell.setAttribute("aria-colindex", "1");

  const art = track.artwork_url?.replace("-large", "-t50x50") ?? "";
  const imgWrap = document.createElement("div");
  imgWrap.className = "sc-sp-img-wrap";
  if (art) {
    imgWrap.innerHTML =
      `<img class="main-image-image main-trackList-rowImage" src="${esc(art)}" ` +
      `alt="" width="40" height="40" style="border-radius:4px" loading="lazy" ` +
      `onerror="this.style.display='none'">` +
      (unavailable
        ? ""
        : `<button class="sc-sp-play-btn" ` +
          `aria-label="${esc(track.title)} (SoundCloud)" tabindex="-1">` +
          PLAY_ICON_SVG +
          `</button>`);
  } else {
    imgWrap.innerHTML = `<div class="sc-sp-img-blank"></div>`;
  }

  const content = document.createElement("div");
  content.className = "main-trackList-rowMainContent";
  content.innerHTML =
    `<div class="e-10451-text encore-text-body-medium encore-internal-color-text-base ` +
    `main-trackList-rowMainContentTitle standalone-ellipsis-one-line" data-encore-id="text" dir="auto">` +
    `<a class="sc-sp-inline-icon sc-sp-source" href="${esc(
      track.sharing === "private" ? track.user.permalink_url : track.permalink_url,
    )}" target="_blank" rel="noreferrer" aria-label="Source: SoundCloud">${SC_SVG_SMALL}</a>${esc(track.title)}` +
    `</div>` +
    `<span class="e-10451-text encore-text-body-small encore-internal-color-text-subdued ` +
    `main-trackList-rowMainContentSubTitle standalone-ellipsis-one-line" data-encore-id="text">` +
    esc(track.user.username) +
    `</span>` +
    (unavailable
      ? `<span class="sc-sp-availability" id="${availabilityId}">${esc(unavailableLabel)}</span>`
      : "");

  leftCell.appendChild(imgWrap);
  leftCell.appendChild(content);

  // Right cell: duration
  const rightCell = document.createElement("div");
  rightCell.className = "main-trackList-rowSectionEnd";
  rightCell.setAttribute("role", "gridcell");
  rightCell.setAttribute("aria-colindex", "2");
  rightCell.innerHTML =
    `<div class="e-10451-text encore-text-body-small encore-internal-color-text-subdued ` +
    `main-trackList-duration" data-encore-id="text">${fmt(track.duration)}</div>`;

  row.appendChild(leftCell);
  row.appendChild(rightCell);
  rowWrap.appendChild(row);

  if (!unavailable) {
    row.addEventListener("mousedown", (e) => e.preventDefault());
  }
  row.querySelector(".sc-sp-source")?.addEventListener("click", (e) =>
    e.stopPropagation(),
  );
  if (!unavailable) {
    row.addEventListener("click", () => {
      player.setQueue(_results, idx, {
      label: _lastQuery ? `Search · ${_lastQuery}` : "SoundCloud Search",
        target: { kind: "main", tab: "search" },
      });
      void player.loadTrack(_results[idx]);
    });
    row.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        player.setQueue(_results, idx, {
        label: _lastQuery ? `Search · ${_lastQuery}` : "SoundCloud Search",
          target: { kind: "main", tab: "search" },
        });
        void player.loadTrack(_results[idx]);
      }
    });
  }

  return rowWrap;
}

// ── Injection helpers ─────────────────────────────────────────────────────────

function clearScRows(): void {
  document.getElementById(SC_GRID_ID)?.remove();
}

function clearSpotifyBadges(): void {
  document
    .querySelectorAll(`.${CLS_SPOTIFY_BADGE}`)
    .forEach((element) => element.remove());
  document
    .querySelectorAll("[data-sc-sp-badge]")
    .forEach((element) =>
      element.removeAttribute("data-sc-sp-badge"),
    );
}

function hasScRows(): boolean {
  return !!document.getElementById(SC_GRID_ID);
}

// Add a Spotify badge to native Spotify rows (idempotent via data-sc-sp-badge).
function addSpotifyBadges(): void {
  if (_destroyed) return;
  const section = document.querySelector(SEL_TRACKS_SECTION);
  if (!section) return;
  section
    .querySelectorAll<HTMLElement>(
      `div[role="row"][draggable="true"]:not([data-sc-sp-badge]) ` +
        `.main-trackList-rowMainContentTitle`,
    )
    .forEach((titleEl) => {
      const row = titleEl.closest<HTMLElement>('div[role="row"]');
      if (!row) return;
      row.setAttribute("data-sc-sp-badge", "1");
      const badge = document.createElement("span");
      badge.className = CLS_SPOTIFY_BADGE;
      badge.style.cssText =
        "display:inline-flex;vertical-align:middle;flex-shrink:0;margin-right:3px";
      badge.innerHTML = SPOTIFY_SVG_INLINE;
      titleEl.insertBefore(badge, titleEl.firstChild);
    });
}

function injectRows(): void {
  clearScRows();
  if (_results.length === 0 || _destroyed) return;

  const section = document.querySelector(SEL_TRACKS_SECTION);
  if (!section) return;

  // The Songs section uses a virtual list (main-rootlist-wrapper) with a fixed
  // pixel height. Appending rows inside it would clip them. Instead, insert a
  // plain wrapper *after* the track list container so rows sit below Spotify's
  // rows visually but are outside the virtual list's clipping boundary.
  const trackListContainer = section.querySelector(SEL_TRACK_LIST_CONTAINER);
  if (!trackListContainer) return;

  const scGrid = document.createElement("div");
  scGrid.id = SC_GRID_ID;
  // Replicate the CSS variables the row grid layout relies on
  scGrid.style.cssText =
    "--row-height:56px;" +
    "--first-min-width:180px;--last-min-width:120px;" +
    "--grid-template-columns:[first] minmax(180px,4fr) [last] minmax(120px,1fr);";

  _results.forEach((track, i) => scGrid.appendChild(buildRow(track, i)));

  trackListContainer.parentElement?.insertBefore(
    scGrid,
    trackListContainer.nextSibling,
  );
  log("search-page", "injected %d SC rows into Songs section", _results.length);
  addSpotifyBadges();
}

// ── Search ────────────────────────────────────────────────────────────────────

function getQueryFromUrl(): string | null {
  const m = window.location.pathname.match(
    /\/(?:intl-[a-z]{2}\/)?search\/([^/?#]+)/,
  );
  return m ? decodeURIComponent(m[1]) : null;
}

async function doSearch(query: string): Promise<void> {
  const generation = ++_searchGeneration;
  log("search-page", "searching: '%s'", query.trim());
  try {
    const data = await searchTracks(query.trim(), 10);
    if (generation !== _searchGeneration || _destroyed) return;
    _results = data?.collection ?? [];
    log("search-page", "got %d SC results", _results.length);
  } catch (e) {
    if (generation !== _searchGeneration || _destroyed) return;
    warn("search-page", "search failed:", e);
    _results = [];
  }
  if (!_destroyed) injectRows();
}

// ── Route change handler ──────────────────────────────────────────────────────

function onRouteChange(): void {
  if (_destroyed) return;

  const page = document.querySelector(SEL_SEARCH_PAGE);

  if (!page) {
    _searchGeneration++;
    if (_searchDebounce !== null) {
      clearTimeout(_searchDebounce);
      _searchDebounce = null;
    }
    if (_pageObs) {
      _pageObs.disconnect();
      _pageObs = null;
    }
    clearScRows();
    _results = [];
    _lastQuery = "";
    return;
  }

  if (!_pageObs) {
    _pageObs = new MutationObserver(() => {
      if (!_destroyed && !hasScRows() && _results.length > 0) {
        injectRows();
      }
    });
    _pageObs.observe(page, { childList: true, subtree: true });
  }

  const query = getQueryFromUrl();
  if (!query) return;

  if (query !== _lastQuery) {
    _searchGeneration++;
    _lastQuery = query;
    _results = [];
    clearScRows();
    if (_searchDebounce !== null) clearTimeout(_searchDebounce);
    _searchDebounce = setTimeout(() => void doSearch(query), 350);
  } else if (!hasScRows() && _results.length > 0) {
    injectRows();
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

const _scWin = window as unknown as { __waveLinkPageSearchInited?: boolean };

export function initSearchPageIntegration(): void {
  if (_scWin.__waveLinkPageSearchInited) return;
  log("search-page", "init");
  _scWin.__waveLinkPageSearchInited = true;
  _destroyed = false;
  injectStyles();

  const hist = (
    Spicetify as unknown as {
      Platform?: { History?: { listen?: (cb: () => void) => () => void } };
    }
  )?.Platform?.History;
  if (hist?.listen) {
    _historyUnlisten = hist.listen(() => {
      if (_destroyed) return;
      if (_navDebounce !== null) clearTimeout(_navDebounce);
      _navDebounce = setTimeout(onRouteChange, 150);
    });
  }

  _pollInterval = setInterval(onRouteChange, 2000);
  onRouteChange();
}

export function destroySearchPageIntegration(): void {
  if (!_scWin.__waveLinkPageSearchInited) return;
  log("search-page", "destroy");
  _scWin.__waveLinkPageSearchInited = false;
  _destroyed = true;
  _searchGeneration++;
  _historyUnlisten?.();
  _historyUnlisten = null;
  if (_pollInterval !== null) {
    clearInterval(_pollInterval);
    _pollInterval = null;
  }
  _pageObs?.disconnect();
  _pageObs = null;
  if (_searchDebounce !== null) {
    clearTimeout(_searchDebounce);
    _searchDebounce = null;
  }
  if (_navDebounce !== null) {
    clearTimeout(_navDebounce);
    _navDebounce = null;
  }
  clearScRows();
  clearSpotifyBadges();
  document.getElementById("sc-sp-styles")?.remove();
  _results = [];
  _lastQuery = "";
}
