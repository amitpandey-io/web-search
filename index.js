/**
 * Search provider for the DSH web capability seam (`ctx.web`), ported from
 * the LM Studio plugin https://lmstudio.ai/altra/web-search (v1.0.1, MIT,
 * author thrilok): keyless SearXNG → DDG → Bing HTML scraping, with
 * optional nomic-embed-text reranking via a local LM Studio instance.
 *
 * Mirrors the dsh-web-search-deepseek namespace-plugin shape: the row's
 * config feeds `apply`; the provider serves each search from the config it
 * was registered with (re-register on reload carries a new one).
 */
import z from "@deepseek-ai/schemastery";
import { WebError } from "@deepseek-ai/dsh-web";
import { ddgSearch, rerankHits } from "./lmstudioSearch.js";

/** Cordis plugin name used by loader diagnostics. */
export const name = "web-search";
/** The web seam this provider registers into. */
export const inject = ["web"];
/** Stable id this provider registers under. */
export const LMSTUDIO_PROVIDER_ID = "lmstudio";

export const Config = z.object({
	/** Base URL of a self-hosted SearXNG instance (e.g. http://localhost:8080); blank = built-in DDG/Bing. */
	searxngUrl: z.string().default(""),
	/** Language/region for search results (e.g. "en-us", "en-gb"); blank = global. */
	defaultLanguage: z.string().default("en-us"),
	/** Recency window: day, week, month, year, any. */
	searchRecencyWindow: z.string().default("year"),
	/** Number of search results to retrieve per query. */
	maxSearchResults: z.number().step(1).min(3).max(20).default(8),
	/** Base URL of a local LM Studio for nomic-embed-text reranking; blank = off. */
	lmStudioUrl: z.string().default("")
});

const TIME = { day: "d", week: "w", month: "m", year: "y", any: "" };

/** Register the LM Studio plugin's keyless search engine with `ctx.web`. */
export function apply(ctx, config) {
	const c = config ?? {};
	const time = TIME[c.searchRecencyWindow ?? "year"] ?? "";
	const maxResults = c.maxSearchResults ?? 8;
	const locale = c.defaultLanguage ?? "en-us";
	const searxngUrl = c.searxngUrl ?? "";
	const lmStudioUrl = (c.lmStudioUrl ?? "").replace(/\/+$/, "");

	ctx.web.registerSearchProvider({
		id: LMSTUDIO_PROVIDER_ID,
		available: () => true,
		async search(request, signal) {
			let hits;
			try {
				hits = await ddgSearch(request.query, maxResults, time, locale, searxngUrl, signal);
				if (lmStudioUrl && hits.length > 1)
					hits = await rerankHits(request.query, hits, lmStudioUrl);
			}
			catch (error) {
				if (signal?.aborted === true || (error instanceof Error && error.name === "AbortError"))
					throw new WebError("LM Studio web search aborted", "WEB_ABORTED", { cause: signal?.aborted === true ? signal.reason : error });
				throw new WebError(`LM Studio web search failed: ${error instanceof Error ? error.message : String(error)}`, "WEB_PROVIDER_ERROR", { cause: error });
			}
			const sources = hits
				.filter((hit) => typeof hit.url === "string" && hit.url.length > 0)
				.map((hit) => ({
					url: hit.url,
					...(hit.title ? { title: hit.title } : {}),
					...(hit.snippet ? { snippet: hit.snippet } : {})
				}));
			return { sources, truncated: false };
		}
	});
}
