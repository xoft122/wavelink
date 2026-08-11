import React, { useState, useCallback } from "react";
import { getDebugLog, clearDebugLog, DebugEntry } from "../services/api";
import { t } from "../i18n";

interface Props {
  onClose: () => void;
}

export function DebugPanel({ onClose }: Props) {
  const [entries, setEntries] = useState<DebugEntry[]>(() => getDebugLog());
  const [selected, setSelected] = useState<number>(0);
  const [copied, setCopied] = useState(false);

  const refresh = useCallback(() => setEntries(getDebugLog()), []);

  const clear = useCallback(() => {
    clearDebugLog();
    setEntries([]);
    setSelected(0);
  }, []);

  const copy = useCallback(() => {
    const entry = entries[selected];
    if (!entry) return;
    const text = JSON.stringify(entry.body, null, 2);
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [entries, selected]);

  const current = entries[selected];
  const prettyJson = current ? JSON.stringify(current.body, null, 2) : "";

  return (
    <div className="sc-debug">
      <div className="sc-debug__header">
        <span className="sc-debug__title">{t("debug_title")}</span>
        <div className="sc-debug__actions">
          <button className="sc-debug__btn" onClick={refresh}>
            {t("debug_refresh")}
          </button>
          <button className="sc-debug__btn" onClick={clear}>
            {t("debug_clear")}
          </button>
          <button className="sc-debug__btn" onClick={copy} disabled={!current}>
            {copied ? t("debug_copied") : t("debug_copy")}
          </button>
          <button
            className="sc-debug__btn sc-debug__btn--close"
            onClick={onClose}
          >
            ✕
          </button>
        </div>
      </div>

      {entries.length === 0 ? (
        <p className="sc-debug__empty">{t("debug_empty")}</p>
      ) : (
        <div className="sc-debug__body">
          {/* Endpoint list */}
          <div className="sc-debug__list">
            {entries.map((e, i) => (
              <div
                key={e.ts}
                className={`sc-debug__entry${i === selected ? " sc-debug__entry--active" : ""}`}
                onClick={() => setSelected(i)}
              >
                <span className="sc-debug__entry-ep">{e.endpoint}</span>
                <span className="sc-debug__entry-ts">
                  {new Date(e.ts).toLocaleTimeString()}
                </span>
              </div>
            ))}
          </div>

          {/* JSON viewer */}
          <div className="sc-debug__json-wrap">
            {current && (
              <p className="sc-debug__url">
                {current.method} {current.endpoint} · HTTP {current.status} ·{" "}
                {current.durationMs} ms
              </p>
            )}
            <textarea
              className="sc-debug__json"
              readOnly
              value={prettyJson}
              spellCheck={false}
            />
          </div>
        </div>
      )}
    </div>
  );
}
