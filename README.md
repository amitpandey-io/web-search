# web-search

A [DSH](https://github.com/deepseek-ai/deepseek-harness) web-seam search
provider ported from the
[LM Studio web-search plugin](https://lmstudio.ai/altra/web-search)
(v1.0.1, MIT, author thrilok).

It registers the `lmstudio` search provider on DSH's web capability seam
(`ctx.web`), backing the model-facing `web_search` tool with **keyless**
tiered search:

1. SearXNG (if `searxngUrl` is configured)
2. DuckDuckGo HTML endpoint
3. Bing HTML fallback

No API key required. Optional reranking via a local LM Studio
`nomic-embed-text` embeddings endpoint.

## Install for DSH

This is a **plain module** — it declares no `dsh.bundle`, so it is installed
by copying the package into DSH's shared profile node tree and wiring the web
seam to it with a cordis patch. Do **not** use `dsh plugin add`: that installs
into the profile's own `node_modules` (invisible to other profiles) and,
without a `dsh.bundle`, never joins the layer stack.

### 0. Prerequisites

- `dsh` is on PATH (or invoke the CLI via node, e.g.
  `node /opt/homebrew/lib/node_modules/@deepseek-ai/dsh/lib/bin.js`).
- DSH home is resolved by `resolveDshHome()`: an explicit configured path,
  then `$DSH_HOME`, then `~/.dsh`. The examples use `~/.dsh` (the default);
  substitute `$DSH_HOME` if you set it.

### 1. Copy the package into the shared profile node tree

The shared tree is `$DSH_HOME/profiles/node_modules` — the flat fallback
every profile's loader resolves through. Copy the plugin files (not `.git`):

```sh
mkdir -p ~/.dsh/profiles/node_modules/web-search
cp README.md index.js lmstudioSearch.js package.json \
  ~/.dsh/profiles/node_modules/web-search/
```

Do **not** install it into a profile's own `node_modules`
(e.g. `~/.dsh/profiles/web/node_modules`): each profile's loader resolves a
cordis row's `name` from that profile's directory tree, so a per-profile
copy is invisible to the other profiles (e.g. `headless`).

### 2. Vendor the source (optional, matches the reference layout)

Keep a vendored copy beside the profile for reference:

```sh
mkdir -p ~/.dsh/profiles/web/vendor/web-search
cp README.md index.js lmstudioSearch.js package.json \
  ~/.dsh/profiles/web/vendor/web-search/
```

This copy is not resolved by the loader — it is a reference of the source.
The loader resolves the shared-tree copy from step 1.

### 3. Add the rows to the target profile's `cordis.patch.yml`

Edit `~/.dsh/profiles/<name>/cordis.patch.yml` (the user patch layer,
applied after every bundle layer) and append:

```yaml
- insert:
    - id: web-search
      name: 'web-search'
      config:
        defaultLanguage: en-us
        searchRecencyWindow: year

- id: web
  config:
    searchProvider: lmstudio
```

Notes:

- The `- id: web` entry **replaces** that row's whole config (patch entries
  do not merge). In the stock layout the row carries only
  `searchProvider`, so nothing is lost. If you have other keys on that row,
  restate them.
- `searchProvider` can alternatively be set via `$DSH_WEB_SEARCH_PROVIDER`,
  but the config row persists.

### 4. Verify

```sh
# composition: the row is inserted and the seam points at the new provider
dsh --profile web --dump-config | grep -B1 -A6 'id: web$'

# direct search (no LLM): confirm the provider returns results
cd ~/.dsh/profiles/web && node -e '
import("web-search").then(async (m) => {
  const ctx = { web: { registerSearchProvider: (p) => { globalThis.__p = p; } } };
  m.apply(ctx, { defaultLanguage: "en-us", searchRecencyWindow: "year" });
  const res = await globalThis.__p.search({ query: "DeepSeek Harness" }, new AbortController().signal);
  console.log("sources:", res.sources.length, "top:", res.sources[0]?.url);
}).catch(e => { console.error(e.message); process.exit(1); });
'

# end-to-end (fresh headless session, patch passed as overlay if the target
# profile is not the one being booted):
dsh --profile headless --patch ~/.dsh/profiles/web/cordis.patch.yml \
  "Use the web_search tool once, with query: 'DeepSeek Harness'. Reply with the top result's title and URL."
```

A running `dsh web` session picks up the change via HMR without a restart:
the profile boot creates an HMR service even when the composed `hmr` row is
disabled, and `watchUserPatches` re-applies the profile patch on change.

## Config

| Key | Default | Meaning |
|---|---|---|
| `searxngUrl` | `""` | Base URL of a self-hosted SearXNG instance (e.g. `http://localhost:8080`). Blank = built-in DDG/Bing. |
| `defaultLanguage` | `en-us` | Language/region for results (e.g. `en-us`, `en-gb`). |
| `searchRecencyWindow` | `year` | `day`, `week`, `month`, `year`, `any`. |
| `maxSearchResults` | `8` | Results retrieved per query (3–20). |
| `lmStudioUrl` | `""` | Base URL of a local LM Studio for `nomic-embed-text` reranking (e.g. `http://localhost:1234`). Blank = off; any rerank failure silently keeps the scrape order. |

## Notes

- Search provider only. The seam's `web_fetch` is untouched (the stock
  `tool-web` row ships with `fetch: false`); the LM Studio plugin's
  `fetch_and_read` / `check_source` / verification tools were not ported.
- `web_search` failures surface through the seam's `WebError` taxonomy
  (`WEB_PROVIDER_ERROR`, `WEB_ABORTED`) as readable tool results.
- The `deepseek-official` provider stays registered if present in your base
  layer; it is simply no longer selected. Remove the `web` patch entry to
  revert.
- `dsh plugin add` is not supported for this plugin: it declares no
  `dsh.bundle`, so it installs as a plain dependency and never joins the
  layer stack. Copy to the shared tree instead (step 1).

## opencode plugin

The same keyless tiered engine is also available as an **opencode custom tool**
(`web_search`). Unlike the DSH provider it is a single self-contained file
(the engine is inlined so it is a one-file drop-in) that registers the tool with
opencode's `tool()` API.

### Install

```sh
mkdir -p ~/.config/opencode/plugins
cp opencode/web-search.js ~/.config/opencode/plugins/web-search.js
```

Restart opencode (plugins in `~/.config/opencode/plugins/` load at startup). The
`@opencode-ai/plugin` package already resolves from `~/.config/opencode/node_modules`,
so no install step is needed. Each `.js` in the plugins dir is loaded as a plugin,
which is why the engine is inlined rather than shared with `lmstudioSearch.js`.

### Usage

The `web_search` tool takes `query` (string, required) and an optional
`maxResults` (3–20, default 8) and returns a text list of title/URL/snippet.

Config is fixed in code at the top of the file (the `CONFIG` block:
`searxngUrl`, `lmStudioUrl`, `locale`, `time`, `defaultMax`) — edit there to
change the search tier, language or recency. `lmStudioUrl` is empty by default,
so the `nomic-embed-text` rerank is off.

```sh
node --input-type=module -e '
import { WebSearch } from "file://'"$HOME"'/.config/opencode/plugins/web-search.js";
const def = (await WebSearch()).tool.web_search;
const r = await def.execute({ query: "DeepSeek Harness" }, { abort: new AbortController().signal });
console.log(r.output);
'
```

## Attribution

Search engine (`lmstudioSearch.js`) vendored verbatim from
`web-search-plugin` v1.0.1 by thrilok,
[https://lmstudio.ai/altra/web-search](https://lmstudio.ai/altra/web-search),
MIT licensed. The adapter (`index.js`), this README, and the opencode
`web-search.js` are new.
