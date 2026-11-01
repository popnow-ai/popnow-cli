import { USER_AGENT } from "./client.js";
export const DOCS_BASE_URL = "https://popnow.ai/docs";
/** The developer MCP server: API key in the Authorization header, paid calls approved in USD. */
export const DEVELOPER_MCP_ENDPOINT = "https://api.popnow.ai/api/v1/mcp";
export const DEVELOPER_MCP_PAGE = "https://popnow.ai/api/mcp";
/** The agent skills catalog for developers, with install commands per agent. */
export const AGENT_SKILLS_PAGE = "https://popnow.ai/api/skills";
function topic(slug, title, summary, url = `${DOCS_BASE_URL}/${slug}`) {
    return { slug, title, summary, url };
}
/**
 * The pages most CLI users need, in reading order. Each slug is a published page under the docs,
 * except `skills`, which is the agent skills catalog itself.
 */
export const DOC_TOPICS = [
    topic("overview", "How the PopNow API works", "What the API can make and the ideas the rest builds on."),
    topic("quickstart", "Quickstart", "Create a key, send a first request and download the result."),
    topic("authentication", "Authentication", "Key format, storage, per-key restrictions and rotation."),
    topic("models", "Models", "Model IDs, prices and input schemas."),
    topic("tasks", "Tasks", "Create, follow, wait for, list, retry and purge tasks."),
    topic("billing", "API balance and billing", "The separate USD API balance: holds, final charges, quotes, usage and spend caps."),
    topic("media", "Media", "Send reference files by URL or upload, and download outputs."),
    topic("assets", "Assets and LoRA files", "The private asset library and popnow://a/ URIs."),
    topic("webhooks", "Webhooks", "Receive finished tasks and verify signatures."),
    topic("idempotency", "Idempotency", "Retry after a timeout without paying twice."),
    topic("errors", "Errors", "Every business code and which ones are worth retrying."),
    topic("limits", "Rate limits", "Request limits and what happens when you exceed them."),
    topic("troubleshooting", "Troubleshooting", "Fixes for the most common problems."),
    topic("mcp", "Developer MCP server", `Connect Claude Code, Cursor, Codex or VS Code to ${DEVELOPER_MCP_ENDPOINT} with an API key; paid calls are approved in USD.`),
    topic("agent-skills", "Agent skills", "Install PopNow skills for coding agents; paid steps are quoted in USD first."),
    topic("skills", "Agent skills catalog", "Browse the skills and copy the install command for your agent.", AGENT_SKILLS_PAGE),
    topic("recipes", "Recipes", "Copy-and-run scripts for common jobs."),
    topic("api-reference", "API reference", "Every endpoint on one page."),
];
/** The machine-readable contract, for tools that want the exact request and response shapes. */
export const OPENAPI_URL = `${DOCS_BASE_URL}/openapi.yaml`;
export function findTopic(slug) {
    const wanted = slug.trim().toLowerCase();
    return DOC_TOPICS.find((item) => item.slug === wanted);
}
/** Strips the search highlighting and the lightest Markdown so a terminal shows plain text. */
function plain(text) {
    return text
        .replace(/<\/?mark>/g, "")
        .replace(/\*\*|__|`/g, "")
        .replace(/\s+/g, " ")
        .trim();
}
/**
 * Searches the live documentation with the same full-text index the docs site's search box uses.
 * Needs no API key. Result URLs from the index are relative to the docs root.
 */
export async function searchDocs(query, options = {}) {
    const words = query.trim();
    if (!words)
        return [];
    const fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
    const url = `${DOCS_BASE_URL}/api/search?${new URLSearchParams({ query: words, locale: "en" })}`;
    const response = await fetchImpl(url, {
        headers: { Accept: "application/json", "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(options.timeoutMs ?? 15_000),
    });
    if (!response.ok)
        throw new Error(`documentation search answered HTTP ${response.status}`);
    const items = (await response.json());
    if (!Array.isArray(items))
        throw new Error("documentation search returned an unexpected shape");
    const seen = new Set();
    const results = [];
    for (const item of items) {
        if (typeof item?.url !== "string" || typeof item.content !== "string")
            continue;
        const absolute = /^https?:\/\//.test(item.url)
            ? item.url
            : `${DOCS_BASE_URL}${item.url.startsWith("/") ? "" : "/"}${item.url}`;
        if (seen.has(absolute))
            continue;
        seen.add(absolute);
        results.push({
            type: typeof item.type === "string" ? item.type : "text",
            text: plain(item.content),
            url: absolute,
        });
        if (results.length >= (options.limit ?? 10))
            break;
    }
    return results;
}
