/**
 * Deep Research Platform - Main entry point for Cloudflare Workers
 *
 * This module serves as the main entry point for the Cloudflare Workers application,
 * handling HTTP requests and routing to appropriate handlers including static assets,
 * agent connections, and workflow management.
 *
 * Key responsibilities:
 * - HTTP request routing and handling
 * - Static asset serving
 * - Agent WebSocket connection management
 * - Workflow binding and execution
 */

import { AgentNamespace, getAgentByName } from "agents";
import { ResearcherAgent } from "./agent";
import { DeepResearchWorkflow } from "./workflow";

/** Environment interface for Cloudflare Workers bindings */
interface Env {
    DEEP_RESEARCH_WORKFLOW: Workflow;
    RESEARCHER_AGENT: AgentNamespace<ResearcherAgent>;
    EXA_API_KEY: string;
    OPENAI_API_KEY: string;
    CLOUDFLARE_ACCOUNT_ID: string;
    CLOUDFLARE_GATEWAY_ID: string;
    ASSETS?: any;
}

// Export classes for Cloudflare Workers runtime
export { ResearcherAgent, DeepResearchWorkflow };

// noinspection JSUnusedGlobalSymbols
/**
 * Main request handler for the Cloudflare Workers application
 * Routes requests to appropriate handlers based on URL path
 */
export default {
    async fetch(req: Request, env: Env): Promise<Response> {
        let url = new URL(req.url);

        // Handle agent routes
        if (url.pathname.startsWith("/api/agent")) {
            try {
                // Extract chatId from query parameters, fallback to default
                const chatId = url.searchParams.get("chatId") || "8457stkn34765se";

                let namedAgent = getAgentByName<{}, ResearcherAgent>(env.RESEARCHER_AGENT, chatId);
                return (await namedAgent).fetch(req);
            } catch (error) {
                console.error("Agent error:", error);
                const errorMessage = error instanceof Error ? error.message : "Unknown error";
                return new Response(JSON.stringify({ error: errorMessage }), {
                    status: 500,
                    headers: { "Content-Type": "application/json" },
                });
            }
        }

        // Handle static asset requests
        if (env.ASSETS) {
            try {
                // Serve static files from the ASSETS binding
                return await env.ASSETS.fetch(req);
            } catch (error) {
                console.error("Asset serving error:", error);
                // Fall through to 404 if asset not found
            }
        }

        // 404 for unmatched routes
        return new Response("Not Found", { status: 404 });
    },
};
