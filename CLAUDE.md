# CLAUDE.md

## web-search

Keyless tiered web search (SearXNG → DDG HTML → Bing HTML) shipped as two
artifacts: a DSH `ctx.web` search provider (`index.js` + `lmstudioSearch.js`)
and a self-contained opencode plugin (`opencode/web-search.js`, engine inlined
on purpose — one-file drop-in, not shared with `lmstudioSearch.js`).

- The search engine functions are MIT-derived from `web-search-plugin` v1.0.1;
  keep the attribution line in `opencode/web-search.js`'s header (license
  requires it) even though product-name references were scrubbed.
- Smoke-test the opencode plugin from a temp dir: `@opencode-ai/plugin` is not
  in this repo, symlink it from `~/.config/opencode/node_modules` into the test
  dir, then `node --input-type=module` importing the file and calling
  `WebSearch().tool.web_search.execute(...)`.
