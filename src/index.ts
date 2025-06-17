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

/**
 * Route definitions using URLPattern API for precise URL matching
 */
const routes = [
    // API routes - these need to be handled by the Worker
    {
        pattern: new URLPattern({ pathname: "/api/agent" }),
        handler: handleAgentRoute,
        name: "agent_websocket",
    },
    {
        pattern: new URLPattern({ pathname: "/api/research" }),
        handler: handleResearchRoute,
        name: "research_api",
    },
];

/**
 * Handle agent-related requests (WebSocket connections)
 */
async function handleAgentRoute(
    req: Request,
    env: Env,
    urlMatch: URLPatternResult,
): Promise<Response> {
    try {
        const url = new URL(req.url);

        // Extract chatId from query parameters, fallback to default
        const chatId = url.searchParams.get("chatId") || "8457stkn34765se";

        const namedAgent = getAgentByName<{}, ResearcherAgent>(env.RESEARCHER_AGENT, chatId);
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

/**
 * Handle research API requests (HTTP REST API)
 */
async function handleResearchRoute(
    req: Request,
    env: Env,
    urlMatch: URLPatternResult,
): Promise<Response> {
    try {
        const url = new URL(req.url);

        // GET: Check status of existing workflow instance
        if (req.method === "GET") {
            const instanceId = url.searchParams.get("instanceId");

            if (!instanceId) {
                return new Response(
                    JSON.stringify({
                        error: "instanceId parameter is required for GET requests",
                    }),
                    {
                        status: 400,
                        headers: { "Content-Type": "application/json" },
                    },
                );
            }

            try {
                const instance = await env.DEEP_RESEARCH_WORKFLOW.get(instanceId);
                const status = await instance.status();

                return new Response(JSON.stringify({ status }), {
                    status: 200,
                    headers: { "Content-Type": "application/json" },
                });
            } catch (error) {
                return new Response(
                    JSON.stringify({
                        error: "Workflow instance not found",
                        instanceId: instanceId,
                    }),
                    {
                        status: 404,
                        headers: { "Content-Type": "application/json" },
                    },
                );
            }
        }

        // POST: Start new research workflow
        if (req.method === "POST") {
            const body = (await req.json()) as {
                searchTopic?: string;
                researchDepth?: number | string;
            };
            const { searchTopic, researchDepth = 2 } = body;

            if (!searchTopic) {
                return new Response(
                    JSON.stringify({ error: "searchTopic is required in request body" }),
                    {
                        status: 400,
                        headers: { "Content-Type": "application/json" },
                    },
                );
            }

            const depth =
                typeof researchDepth === "string" ? parseInt(researchDepth) : researchDepth;

            // Create workflow instance with research parameters
            const instance = await env.DEEP_RESEARCH_WORKFLOW.create({
                params: {
                    searchTopic,
                    researchDepth: depth,
                    timestamp: Date.now(),
                },
            });

            return new Response(
                JSON.stringify({
                    id: instance.id,
                    message: "Research workflow started",
                    topic: searchTopic,
                    depth: depth,
                    details: await instance.status(),
                }),
                {
                    status: 201, // Created
                    headers: { "Content-Type": "application/json" },
                },
            );
        }

        // Method not allowed
        return new Response(
            JSON.stringify({
                error: "Method not allowed. Use GET to check status or POST to start research.",
            }),
            {
                status: 405,
                headers: {
                    "Content-Type": "application/json",
                    Allow: "GET, POST",
                },
            },
        );
    } catch (error) {
        console.error("Research API error:", error);
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        return new Response(JSON.stringify({ error: errorMessage }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
        });
    }
}

// noinspection JSUnusedGlobalSymbols
/**
 * Main request handler for the Cloudflare Workers application
 * Uses URLPattern API for precise API routing.
 *
 * Note: Static files (HTML, CSS, JS, images) are automatically served by
 * Cloudflare Workers Assets from the ./public/ directory and don't need
 * explicit routing in the Worker code.
 */
export default {
    async fetch(req: Request, env: Env): Promise<Response> {
        const url = req.url;

        // Only handle API routes - static files are served automatically by Cloudflare
        for (const route of routes) {
            const match = route.pattern.exec(url);
            if (match) {
                return route.handler(req, env, match);
            }
        }

        // If no route matched, return 404
        return new Response("Not Found", { status: 404 });
    },
};
