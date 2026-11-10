// Ambient declarations for Spicetify globals not bundled by spicetify-creator.
// Only the subset used by WaveLink is declared here.

declare namespace Spicetify {
  namespace LocalStorage {
    function get(key: string): string | null;
    function set(key: string, value: string): void;
    function remove(key: string): void;
  }

  namespace Player {
    /** Current playback state; populated by Spicetify before any event fires. */
    const data: {
      isPaused: boolean;
      duration: number;
      position: number;
      item?: { uri: string };
    } | null;

    function addEventListener(
      event: "onplaypause" | "songchange" | string,
      callback: (event?: Event) => void,
    ): void;
    function removeEventListener(
      event: string,
      callback: (event?: Event) => void,
    ): void;
    function play(): void;
    function pause(): void;
    function seek(posMs: number): void;
    function next(): void;
    function back(): void;
    function getMute(): boolean;
    function setMute(mute: boolean): void;
    function getVolume(): number;
    function setVolume(vol: number): void;
    function isPlaying(): boolean;
  }

  interface NativeRequestResponse {
    status: number;
    body: unknown;
    headers?: Record<string, string> | Array<{ key: string; value: string }>;
  }

  interface NativeRequest {
    fromURL(url: string): NativeRequest;
    withMethod(method: string): NativeRequest;
    withBody(body: unknown): NativeRequest;
    withHeaders(headers: Array<{ key: string; value: string }>): NativeRequest;
    withJsonContentType(): NativeRequest;
    withResponseType(type: string): NativeRequest;
    withoutAuthorization(): NativeRequest;
    withoutGlobalHeaders(): NativeRequest;
    withoutMarket(): NativeRequest;
    send(): Promise<NativeRequestResponse>;
  }

  interface NativeRequestBuilder {
    build(): NativeRequest;
  }

  interface PlatformLocalStorageAPI {
    getItem(key: string): unknown;
    setItem(key: string, value: unknown): void;
    clearItem(key: string): void;
  }

  /** Native transport with Spotify credentials explicitly disabled by WaveLink. */
  const Platform: {
    RequestBuilder?: NativeRequestBuilder;
    LocalStorageAPI?: PlatformLocalStorageAPI;
    ClipboardAPI?: { copy(text: string): void | Promise<void> };
    [key: string]: unknown;
  };

  const React: typeof import("react");
  const ReactDOM: typeof import("react-dom");
  namespace PopupModal {
    interface Content {
      title: string;
      content: string | Element | import("react").ReactNode;
      isLarge?: boolean;
    }

    function display(content: Content): void;
    function hide(): void;
  }

  function showNotification(
    message: string,
    isError?: boolean,
    timeout?: number,
  ): void;
}

// Allow runtime guard: `if (window.Spicetify?.Player)` without a TS error.
interface Window {
  Spicetify?: typeof Spicetify;
}
