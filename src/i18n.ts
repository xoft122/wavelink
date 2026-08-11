type Translation = string | ((...args: string[]) => string);
type Strings = Record<string, Translation>;

const EN: Strings = {
  view_feed: "Your feed",
  view_liked: "Liked tracks",
  view_sets: "Your playlists",
  load_more: "Load more",
  tab_feed: "Feed",
  tab_search: "Search",
  tab_liked: "Liked",
  tab_sets: "Playlists",
  tab_settings: "Settings",
  loading: "Loading…",
  empty_feed: "Your SoundCloud feed is empty.",
  empty_liked: "No liked tracks found.",
  empty_sets: "No playlists found.",
  no_results: (query) => `No results for “${query}”`,
  search_placeholder: "Search SoundCloud…",
  btn_search: "Search",
  back: "Playlists",
  track_count: (count) => `${count} tracks`,
  debug_title: "Debug — SoundCloud responses",
  debug_refresh: "Refresh",
  debug_clear: "Clear",
  debug_copy: "Copy JSON",
  debug_copied: "Copied!",
  debug_empty: "No SoundCloud calls logged yet.",
};

const UK: Strings = {
  view_feed: "Ваша стрічка",
  view_liked: "Вподобані треки",
  view_sets: "Ваші плейлисти",
  load_more: "Завантажити ще",
  tab_feed: "Стрічка",
  tab_search: "Пошук",
  tab_liked: "Вподобані",
  tab_sets: "Плейлисти",
  tab_settings: "Налаштування",
  loading: "Завантаження…",
  empty_feed: "Ваша стрічка SoundCloud порожня.",
  empty_liked: "Вподобаних треків не знайдено.",
  empty_sets: "Плейлистів не знайдено.",
  no_results: (query) => `Нічого не знайдено за запитом «${query}»`,
  search_placeholder: "Пошук у SoundCloud…",
  btn_search: "Знайти",
  back: "Плейлисти",
  track_count: (count) => `${count} треків`,
  debug_title: "Діагностика — відповіді SoundCloud",
  debug_refresh: "Оновити",
  debug_clear: "Очистити",
  debug_copy: "Копіювати JSON",
  debug_copied: "Скопійовано!",
  debug_empty: "Викликів SoundCloud ще не було.",
};

const TRANSLATIONS: Record<string, Strings> = { en: EN, uk: UK, ua: UK };

function detectLang(): string {
  try {
    const htmlLanguage = document.documentElement.lang;
    if (htmlLanguage) return htmlLanguage.split(/[-_]/)[0].toLowerCase();
  } catch {}
  try {
    const locale = (
      Spicetify as unknown as { Locale?: { getLocale?(): string } }
    ).Locale?.getLocale?.();
    if (locale) return locale.split(/[-_]/)[0].toLowerCase();
  } catch {}
  return (navigator.language || "en").split(/[-_]/)[0].toLowerCase();
}

let language: string | null = null;

export function t(key: string, ...args: string[]): string {
  if (!language) language = detectLang();
  const value =
    (TRANSLATIONS[language] ?? EN)[key] ?? EN[key] ?? key;
  return typeof value === "function" ? value(...args) : value;
}

export function tWithKbd(key: string): Array<string | { kbd: string }> {
  return t(key)
    .split(/(\{[^}]+\})/)
    .map((part) => {
      const match = part.match(/^\{(.+)\}$/);
      return match ? { kbd: match[1] } : part;
    });
}
