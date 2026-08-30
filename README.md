# lmstudio-web-search

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

## Install

### 1. Copy the package into the shared profile node tree

```sh
mkdir -p ~/.dsh/profiles/node_modules
cp -R <this directory> ~/.dsh/profiles/node_modules/lmstudio-web-search
```

Do **not** install it into a profile's own `node_modules`
(e.g. `~/.dsh/profiles/web/node_modules`): each profile's loader resolves a
cordis row's `name` from that profile's directory tree, so a per-profile
copy is invisible to the other profiles.

### 2. Add the rows to the target profile's `cordis.patch.yml`

Edit `~/.dsh/profiles/<name>/cordis.patch.yml` (the user patch layer,
applied after every bundle layer) and append:

```yaml
- insert:
    - id: web-search-lmstudio
      name: 'lmstudio-web-search'
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

### 3. Verify

```sh
# composition: the row is inserted and the seam points at the new provider
dsh --profile <name> --dump-config | grep -B1 -A6 'id: web$'

# end-to-end (fresh headless session, patch passed as overlay if the target
# profile is not the one being booted):
dsh --profile headless --patch ~/.dsh/profiles/<name>/cordis.patch.yml \
  "Use the web_search tool once, with query: 'DeepSeek Harness'. Reply with the top result's title and URL."
```

A running `dsh web` session picks up the change via HMR without a restart.

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

## Attribution

Search engine (`lmstudioSearch.js`) vendored verbatim from
`web-search-plugin` v1.0.1 by thrilok,
[https://lmstudio.ai/altra/web-search](https://lmstudio.ai/altra/web-search),
MIT licensed. The adapter (`index.js`) and this README are new.
