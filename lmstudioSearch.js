/**
 * Web search core, vendored from the LM Studio plugin
 * https://lmstudio.ai/altra/web-search (web-search-plugin v1.0.1, MIT,
 * author thrilok). Its toolsProvider.js written for the @lmstudio/sdk tool
 * API is not loadable by DSH; this file keeps the self-contained search
 * engine (native fetch, no API key) verbatim: SearXNG → DDG HTML scrape →
 * Bing fallback, with optional nomic-embed-text reranking.
 */

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
    // DDG HTML: kl=locale, df=d|w|m|y for time filter
    const params = new URLSearchParams({ q: query, kl: locale });
    if (time)
        params.set("df", time);
    const html = await fetchSearchHtml(`https://html.duckduckgo.com/html/?${params}`, 10_000, signal);
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
// Bing HTML search has no reliable URL-based freshness parameter.
// (tbs=qdr:X is Google's parameter and was silently ignored by Bing.)
// Time filtering is handled by SearXNG and DDG tiers above.
async function scrapeBing(query, max, _time, signal) {
    const html = await fetchSearchHtml(`https://www.bing.com/search?q=${encodeURIComponent(query)}&count=${max}&setlang=en&cc=us`, 10_000, signal);
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
// SearXNG time_range values: day | week | month | year
const SEARXNG_TIME = { d: "day", w: "week", m: "month", y: "year" };
async function searchSearXNG(baseUrl, query, max, timeoutMs = 10_000, time, signal) {
    const params = { q: query, format: "json" };
    if (time)
        params["time_range"] = SEARXNG_TIME[time] ?? "";
    const url = `${baseUrl.replace(/\/$/, "")}/search?${new URLSearchParams(params)}`;
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
async function ddgSearch(query, maxResults, time, locale = "en-us", searxngUrl, signal) {
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
    const res = await fetch(`${baseUrl}/v1/embeddings`, {
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
export { ddgSearch, rerankHits };
