export declare const DOCS_BASE_URL = "https://popnow.ai/docs";
/** The developer MCP server: API key in the Authorization header, paid calls approved in USD. */
export declare const DEVELOPER_MCP_ENDPOINT = "https://api.popnow.ai/api/v1/mcp";
export declare const DEVELOPER_MCP_PAGE = "https://popnow.ai/api/mcp";
/** The agent skills catalog for developers, with install commands per agent. */
export declare const AGENT_SKILLS_PAGE = "https://popnow.ai/api/skills";
export interface DocTopic {
    slug: string;
    title: string;
    summary: string;
    url: string;
}
/**
 * The pages most CLI users need, in reading order. Each slug is a published page under the docs,
 * except `skills`, which is the agent skills catalog itself.
 */
export declare const DOC_TOPICS: readonly DocTopic[];
/** The machine-readable contract, for tools that want the exact request and response shapes. */
export declare const OPENAPI_URL = "https://popnow.ai/docs/openapi.yaml";
export declare function findTopic(slug: string): DocTopic | undefined;
export interface DocSearchResult {
    type: string;
    text: string;
    url: string;
}
/**
 * Searches the live documentation with the same full-text index the docs site's search box uses.
 * Needs no API key. Result URLs from the index are relative to the docs root.
 */
export declare function searchDocs(query: string, options?: {
    limit?: number;
    fetch?: typeof fetch;
    timeoutMs?: number;
}): Promise<DocSearchResult[]>;
