import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const [source, appCss] = await Promise.all([
  readFile(
    new URL("../src/components/OAuthOnboarding.tsx", import.meta.url),
    "utf8",
  ),
  readFile(new URL("../src/styles/app.css", import.meta.url), "utf8"),
]);

function sourceSlice(startMarker, endMarker) {
  const start = appCss.indexOf(startMarker);
  const end = appCss.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0, `Missing CSS marker: ${startMarker}`);
  assert.ok(end > start, `Missing CSS marker after ${startMarker}`);
  return appCss.slice(start, end);
}

test("authorization screen gives concise DevTools credential instructions", () => {
  assert.match(source, /Get your credentials from DevTools/);
  assert.match(source, /soundcloud\.com/);
  assert.match(source, /<kbd>F12<\/kbd>/);
  assert.match(source, /<strong>Network<\/strong>/);
  assert.match(source, /api-v2\.soundcloud\.com/);
  assert.match(source, /client_id=/);
  assert.match(source, /Request Headers/);
  assert.match(source, /Authorization: OAuth/);
  assert.equal(
    [...source.matchAll(/className="wl-onboarding__credential-step"/g)].length,
    4,
  );
});

test("the Network filter button copies the displayed hostname and handles clipboard failure", async () => {
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      jsx: ts.JsxEmit.React,
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
    },
  }).outputText;
  const load = new Function("require", "exports", "window", "navigator", compiled);
  const createElement = (tag, props, ...children) => ({ tag, props, children });
  const find = (node, predicate) => {
    if (!node || typeof node !== "object") return undefined;
    if (predicate(node)) return node;
    for (const child of node.children) {
      const found = find(child, predicate);
      if (found) return found;
    }
  };

  for (const mode of ["standard", "spotify", "unavailable"]) {
    const writes = [];
    const notifications = [];
    const exports = {};
    load(
      (path) => path === "react" ? { createElement } : { WebSessionForm() {} },
      exports,
      {
        Spicetify: {
          Platform: {
            ClipboardAPI: mode === "unavailable" ? undefined : {
              copy: (text) => writes.push(["spotify", text]),
            },
          },
          showNotification: (...args) => notifications.push(args),
        },
      },
      {
        clipboard: {
          writeText: async (text) => {
            if (mode !== "standard") throw new Error("Clipboard blocked");
            writes.push(["standard", text]);
          },
        },
      },
    );
    const view = exports.OAuthOnboarding({ isConnecting: false, error: null });
    const filter = find(view, (node) => node.props?.className === "wl-onboarding__network-filter");
    const [code, button] = filter.children;
    assert.equal(code.children.join(""), "api-v2.soundcloud.com");
    assert.equal(button.tag, "button");
    assert.equal(button.props.type, "button");
    await button.props.onClick();

    if (mode === "unavailable") {
      assert.deepEqual(writes, []);
      assert.equal(notifications[0][1], true);
      assert.match(notifications[0][0], /copy it manually/i);
    } else {
      assert.deepEqual(writes, [[mode, code.children.join("")]]);
      assert.deepEqual(notifications, [["Network filter copied."]]);
    }
  }
});

test("legacy connection feature steps are no longer shown", () => {
  assert.doesNotMatch(source, /wl-onboarding__steps/);
  assert.doesNotMatch(source, /No Client Secret/);
  assert.doesNotMatch(source, /No localhost bridge/);
  assert.doesNotMatch(source, /Full WaveLink library/);
});

test("front-card SoundCloud label scales to its own card width", () => {
  const cardRule = sourceSlice(
    ".wl-onboarding__art-card {",
    ".wl-onboarding__art-card::after {",
  );
  const labelRule = sourceSlice(
    ".wl-onboarding__soundcloud-wordmark {",
    ".wl-onboarding__art-card--front span {",
  );

  assert.match(
    source,
    /<strong className="wl-onboarding__soundcloud-wordmark">SOUNDCLOUD<\/strong>/,
  );
  assert.match(cardRule, /container-type:\s*inline-size;/);
  assert.match(labelRule, /max-width:\s*100%;/);
  assert.match(labelRule, /font-size:\s*clamp\(20px,\s*13cqi,\s*36px\);/);
  assert.match(labelRule, /white-space:\s*nowrap;/);
});

test("credential guide keeps a minimal header and semantic numbered steps", () => {
  assert.match(
    source,
    /<header className="wl-onboarding__credential-header">/,
  );
  assert.doesNotMatch(source, /wl-onboarding__credential-icon/);
  assert.doesNotMatch(source, /wl-onboarding__credential-kicker/);
  assert.doesNotMatch(source, /wl-onboarding__credential-badge/);
  assert.match(
    source,
    /<ol className="wl-onboarding__credential-steps" role="list">/,
  );
  assert.deepEqual(
    [
      ...source.matchAll(
        /className="wl-onboarding__credential-step-number"[\s\S]*?>\s*(\d{2})\s*<\/span>/g,
      ),
    ].map((match) => match[1]),
    ["01", "02", "03", "04"],
  );

  const guideRule = sourceSlice(
    ".wl-onboarding__credential-help {",
    ".wl-onboarding__card > .wl-credentials {",
  );
  const headerRule = sourceSlice(
    ".wl-onboarding__credential-header {",
    ".wl-onboarding__credential-header h2 {",
  );

  assert.doesNotMatch(guideRule, /container-(?:name|type):/);
  assert.doesNotMatch(guideRule, /box-shadow:/);
  assert.doesNotMatch(guideRule, /filter:/);
  assert.doesNotMatch(guideRule, /linear-gradient\(/);
  assert.doesNotMatch(
    appCss,
    /\.wl-onboarding__credential-help::(?:before|after)/,
  );
  assert.match(headerRule, /border-bottom:\s*1px solid/);
});

test("credential steps stay one-column with larger readable copy", () => {
  const stepsRule = sourceSlice(
    ".wl-onboarding__credential-steps {",
    ".wl-onboarding__credential-step {",
  );
  const stepRule = sourceSlice(
    ".wl-onboarding__credential-step {",
    ".wl-onboarding__credential-step + .wl-onboarding__credential-step {",
  );
  const separatorRule = sourceSlice(
    ".wl-onboarding__credential-step + .wl-onboarding__credential-step {",
    ".wl-onboarding__credential-step-number {",
  );
  const headerCopyRule = sourceSlice(
    ".wl-onboarding__credential-header p {",
    ".wl-onboarding__credential-steps {",
  );
  const titleRule = sourceSlice(
    ".wl-onboarding__credential-step-copy > strong {",
    ".wl-onboarding__credential-step-copy > span {",
  );
  const copyRule = sourceSlice(
    ".wl-onboarding__credential-step-copy > span {",
    ".wl-onboarding__credential-step-copy > span strong {",
  );
  const codeRule = sourceSlice(
    ".wl-onboarding__credential-help code,",
    ".wl-onboarding__error {",
  );

  assert.match(stepsRule, /grid-template-columns:\s*minmax\(0,\s*1fr\);/);
  assert.match(stepsRule, /list-style:\s*none;/);
  assert.doesNotMatch(stepRule, /border-radius:/);
  assert.doesNotMatch(stepRule, /background:/);
  assert.match(separatorRule, /border-top:\s*1px solid/);
  assert.match(headerCopyRule, /font-size:\s*11\.5px;/);
  assert.match(titleRule, /font-size:\s*12\.5px;/);
  assert.match(titleRule, /line-height:\s*inherit;/);
  assert.match(copyRule, /font-size:\s*12px;/);
  assert.match(copyRule, /line-height:\s*inherit;/);
  assert.doesNotMatch(appCss, /@container wavelink-credential-guide/);
  assert.match(codeRule, /white-space:\s*normal;/);
  assert.doesNotMatch(codeRule, /white-space:\s*nowrap;/);
});
