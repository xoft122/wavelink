import React, { useEffect, useLayoutEffect, useRef } from "react";

import { clampHistoryContextMenuPosition } from "../services/historyContextMenu";
import { SCTrack } from "../types/soundcloud";

interface Props {
  track: SCTrack;
  clientX: number;
  clientY: number;
  playedAt: number;
  onDelete: (track: SCTrack, playedAt: number) => void;
  onDismiss: (restoreFocus?: boolean) => void;
}

const DeleteIcon = () => (
  <svg
    viewBox="0 0 24 24"
    width="18"
    height="18"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M4 7h16" />
    <path d="M9 3h6l1 4H8l1-4Z" />
    <path d="m7 7 1 14h8l1-14" />
    <path d="M10 11v6M14 11v6" />
  </svg>
);

export function HistoryContextMenu({
  track,
  clientX,
  clientY,
  playedAt,
  onDelete,
  onDismiss,
}: Props) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const deleteButtonRef = useRef<HTMLButtonElement | null>(null);

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;

    const bounds = menu.getBoundingClientRect();
    const position = clampHistoryContextMenuPosition(
      clientX,
      clientY,
      window.innerWidth,
      window.innerHeight,
      bounds.width,
      bounds.height,
    );
    menu.style.left = `${position.left}px`;
    menu.style.top = `${position.top}px`;
    deleteButtonRef.current?.focus({ preventScroll: true });
  }, [clientX, clientY, track.urn]);

  useEffect(() => {
    const dismissIfOutside = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && menuRef.current?.contains(target)) return;
      onDismiss(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onDismiss(true);
        return;
      }
      if (event.key === "Tab") {
        onDismiss(false);
        return;
      }
      if (
        event.key === "ArrowDown" ||
        event.key === "ArrowUp" ||
        event.key === "Home" ||
        event.key === "End"
      ) {
        event.preventDefault();
        deleteButtonRef.current?.focus({ preventScroll: true });
      }
    };
    const dismissForViewportChange = () => onDismiss(false);

    document.addEventListener("pointerdown", dismissIfOutside, true);
    document.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("blur", dismissForViewportChange);
    window.addEventListener("resize", dismissForViewportChange);
    window.addEventListener("scroll", dismissForViewportChange, true);
    return () => {
      document.removeEventListener("pointerdown", dismissIfOutside, true);
      document.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("blur", dismissForViewportChange);
      window.removeEventListener("resize", dismissForViewportChange);
      window.removeEventListener("scroll", dismissForViewportChange, true);
    };
  }, [onDismiss]);

  return Spicetify.ReactDOM.createPortal(
    <div
      ref={menuRef}
      className="wl-history-context-menu"
      data-wl-owned="true"
      role="menu"
      aria-label={`Recently played actions for ${track.title}`}
      style={{ left: clientX, top: clientY }}
      onContextMenu={(event) => event.preventDefault()}
      onBlur={(event) => {
        const nextTarget = event.relatedTarget;
        if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) {
          return;
        }
        onDismiss(false);
      }}
    >
      <button
        ref={deleteButtonRef}
        type="button"
        role="menuitem"
        className="wl-history-context-menu__delete"
        aria-label={`Delete ${track.title} from Recently played`}
        onClick={() => onDelete(track, playedAt)}
      >
        <DeleteIcon />
        <span>Delete</span>
      </button>
    </div>,
    document.body,
  );
}
