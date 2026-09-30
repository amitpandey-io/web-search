// # opencode web_search tool
//
// Custom opencode tool (`web_search`) that exposes keyless, tiered web search —
// SearXNG (if configured) → DuckDuckGo HTML → Bing HTML fallback — backed by the
// same search engine as the DSH `web-search` provider
// (https://github.com/amitpandey-io/web-search, itself ported from the LM Studio
// web-search plugin v1.0.1 by thrilok, MIT). No API key required.
//
// Loaded automatically from ~/.config/opencode/plugins/. Fixed in-code config;
// edit the CONFIG block below to change the search tier, language or recency.

import { tool } from "@opencode-ai/plugin";

// --- CONFIG (fixed in code) -------------------------------------------------
const CONFIG = {
	searxngUrl: "", // self-hosted SearXNG base URL; "" = built-in DDG/Bing
	lmStudioUrl: "", // local LM Studio for nomic-embed-text rerank; "" = off
	locale: "en-us", // language/region for results
	time: "y", // recency: d|w|m|y|"" (day|week|month|year|any)
	defaultMax: 8, // results per query (3-20)
};

const SEARXNG_TIME = { d: "day", w: "week", m: "month", y: "year" };

// --- search engine (vendored from the reference lmstudioSearch.js) ----------

function decodeHtmlEntities(s) {
	return s
		.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ");
}
function stripTagsSearch(html) {
	return decodeHtmlEntities(html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}
async function fetchSearchHtml(url, timeoutMs = 10_000, signal) {
	const fetchSignal = signal
		? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
		: AbortSignal.timeout(timeoutMs);
	const res = await fetch(url, {
		signal: fetchSignal,
		headers: {
			"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
			"Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
			"Accept-Language": "en-US,en;q=0.9",
		},
	});
	if (!res.ok)
		throw new Error(`HTTP ${res.status}`);
	return await res.text();
}
async function scrapeDDG(query, max, time, locale = "en-us", signal) {
	const params = new URLSearchParams({ q: query, kl: locale });
	if (time)
		params.set("df", time);
	const html = await fetchSearchHtml("https://html.duckduckgo.com/html/?" + params, 10_000, signal);
	const links = [];
	const linkRe = /class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
	let m;
	while ((m = linkRe.exec(html)) !== null && links.length < max) {
		const uddg = m[1].match(/[?]uddg=([^&"]+)/);
		let url = m[1];
		if (uddg) {
			try {
				url = decodeURIComponent(uddg[1]);
			}
			catch {
				continue;
			}
		}
		if (!url.startsWith("http"))
			continue;
		const title = stripTagsSearch(m[2]);
		if (title)
			links.push({ url, title });
	}
	if (links.length === 0)
		return [];
	const snippets = [];
	const snipRe = /class="result__snippet"[^>]*>([\s\S]*?)<\/(?:div|a)>/g;
	let sm;
	while ((sm = snipRe.exec(html)) !== null)
		snippets.push(stripTagsSearch(sm[1]));
	return links.map((l, i) => ({ ...l, snippet: snippets[i] ?? "" }));
}
async function scrapeBing(query, max, _time, signal) {
	const html = await fetchSearchHtml("https://www.bing.com/search?q=" + encodeURIComponent(query) + "&count=" + max + "&setlang=en&cc=us", 10_000, signal);
	const results = [];
	const liRe = /<li class="b_algo">([\s\S]*?)<\/li>/g;
	let m;
	while ((m = liRe.exec(html)) !== null && results.length < max) {
		const block = m[1];
		const linkM = block.match(/<h2[^>]*>\s*<a[^>]+href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/);
		if (!linkM)
			continue;
		const title = stripTagsSearch(linkM[2]);
		if (!title)
			continue;
		const snipM = block.match(/<div class="b_caption"[^>]*>[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/) ??
			block.match(/<p[^>]*>([\s\S]*?)<\/p>/);
		results.push({ title, url: linkM[1], snippet: snipM ? stripTagsSearch(snipM[1]) : "" });
	}
	return results;
}
async function searchSearXNG(baseUrl, query, max, timeoutMs = 10_000, time, signal) {
	const params = { q: query, format: "json" };
	if (time)
		params["time_range"] = SEARXNG_TIME[time] ?? "";
	const url = baseUrl.replace(/\/$/, "") + "/search?" + new URLSearchParams(params);
	const fetchSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
	const res = await fetch(url, { signal: fetchSignal, headers: { "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36" } });
	if (!res.ok)
		throw new Error(`SearXNG HTTP ${res.status}`);
	const data = await res.json();
	return (data.results ?? []).slice(0, max).map((r) => ({
		title: r.title ?? "",
		url: r.url ?? "",
		snippet: r.content ?? "",
	}));
}
/** Tiered keyless search: SearXNG (if configured) → DDG → Bing. */
async function searchWeb(query, maxResults, time, locale, searxngUrl, signal) {
	if (searxngUrl) {
		try {
			const r = await searchSearXNG(searxngUrl, query, maxResults, 10_000, time, signal);
			if (r.length > 0)
				return r;
		}
		catch { /* fall through */ }
	}
	try {
		const results = await scrapeDDG(query, maxResults, time, locale, signal);
		if (results.length > 0)
			return results;
	}
	catch { /* fall through to Bing */ }
	try {
		return await scrapeBing(query, maxResults, time, signal);
	}
	catch {
		return [];
	}
}
async function embedTexts(texts, baseUrl) {
	const res = await fetch(baseUrl + "/v1/embeddings", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ model: "nomic-embed-text", input: texts }),
		signal: AbortSignal.timeout(10_000),
	});
	if (!res.ok)
		throw new Error(`Embeddings API ${res.status}`);
	const data = await res.json();
	return data.data.map((d) => d.embedding);
}
function cosine(a, b) {
	let dot = 0, na = 0, nb = 0;
	for (let i = 0; i < a.length; i++) {
		dot += a[i] * b[i];
		na += a[i] * a[i];
		nb += b[i] * b[i];
	}
	return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}
/** Optional rerank via a local LM Studio embeddings endpoint; any failure keeps the original order. */
async function rerankHits(query, hits, baseUrl) {
	if (hits.length <= 1)
		return hits;
	try {
		const inputs = [
			`search_query: ${query}`,
			...hits.map((h) => `search_document: ${h.title} ${h.snippet}`),
		];
		const embeddings = await embedTexts(inputs, baseUrl);
		if (embeddings.length !== inputs.length)
			return hits;
		const queryEmb = embeddings[0];
		const scored = hits.map((h, i) => ({ h, score: cosine(queryEmb, embeddings[i + 1]) }));
		scored.sort((a, b) => b.score - a.score);
		return scored.map((s) => s.h);
	}
	catch {
		return hits;
	}
}

// --- plugin -----------------------------------------------------------------

function formatResults(query, hits) {
	if (hits.length === 0)
		return `No results found for "${query}".`;
	const lines = hits.map((h, i) => {
		const top = `${i + 1}. ${h.title ?? "(untitled)"}\n   ${h.url}`;
		return h.snippet ? `${top}\n   ${h.snippet}` : top;
	});
	return `Web search results for "${query}":\n\n${lines.join("\n\n")}`;
}

export const WebSearch = async () => {
	return {
		tool: {
			web_search: tool({
				description:
					"Keyless web search (SearXNG → DuckDuckGo → Bing). Returns a list of " +
					"results with title, URL and snippet for the given query. No API key required.",
				args: {
					query: tool.schema.string().describe("Search query"),
					maxResults: tool.schema
						.number()
						.int()
						.min(3)
						.max(20)
						.optional()
						.describe("Number of results to return (3-20)"),
				},
				async execute(args, context) {
					const maxResults = args.maxResults ?? CONFIG.defaultMax;
					let hits = await searchWeb(
						args.query,
						maxResults,
						CONFIG.time,
						CONFIG.locale,
						CONFIG.searxngUrl,
						context.abort,
					);
					if (CONFIG.lmStudioUrl && hits.length > 1)
						hits = await rerankHits(args.query, hits, CONFIG.lmStudioUrl);
					return { title: `Web search: ${args.query}`, output: formatResults(args.query, hits) };
				},
			}),
		},
	};
};
