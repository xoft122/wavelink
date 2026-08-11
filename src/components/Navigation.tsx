import React from "react";

export type MainTab = "home" | "search" | "library" | "settings";

interface IconProps { name: MainTab }

function Icon({ name }: IconProps) {
  if (name === "home") {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3V10.5Z" /></svg>;
  }
  if (name === "search") {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10.5 4a6.5 6.5 0 1 0 3.98 11.64L20 21.17 21.17 20l-5.53-5.52A6.5 6.5 0 0 0 10.5 4Zm0 1.75a4.75 4.75 0 1 1 0 9.5 4.75 4.75 0 0 1 0-9.5Z" /></svg>;
  }
  if (name === "library") {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 3h3v18H4V3Zm5 0h3v18H9V3Zm5.3 1.2 2.85-1.03L22 18.8l-2.85 1.03L14.3 4.2Z" /></svg>;
  }
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10.7 2h2.6l.55 2.2c.55.2 1.07.5 1.54.88l2.13-.66 1.84 1.84-.66 2.13c.37.47.67.99.88 1.54l2.2.55v2.6l-2.2.55a8.2 8.2 0 0 1-.88 1.54l.66 2.13-1.84 1.84-2.13-.66a8.2 8.2 0 0 1-1.54.88L13.3 22h-2.6l-.55-2.2a8.2 8.2 0 0 1-1.54-.88l-2.13.66-1.84-1.84.66-2.13a8.2 8.2 0 0 1-.88-1.54l-2.2-.55v-2.6l2.2-.55c.21-.55.51-1.07.88-1.54l-.66-2.13 1.84-1.84 2.13.66c.47-.37.99-.67 1.54-.88L10.7 2ZM12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z" /></svg>;
}

const ITEMS: Array<{ id: MainTab; label: string }> = [
  { id: "home", label: "Home" },
  { id: "search", label: "Search" },
  { id: "library", label: "Library" },
  { id: "settings", label: "Settings" },
];

interface Props {
  active: MainTab;
  onChange: (tab: MainTab) => void;
}

export function Navigation({ active, onChange }: Props) {
  return (
    <nav className="wl-nav" aria-label="WaveLink">
      {ITEMS.map((item) => (
        <button
          type="button"
          key={item.id}
          className={active === item.id ? "wl-nav__item wl-nav__item--active" : "wl-nav__item"}
          onClick={() => onChange(item.id)}
          aria-current={active === item.id ? "page" : undefined}
          aria-label={item.label}
          title={item.label}
        >
          <Icon name={item.id} />
          <span>{item.label}</span>
        </button>
      ))}
    </nav>
  );
}
