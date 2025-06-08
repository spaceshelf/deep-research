import { createOpenAI } from "@ai-sdk/openai";

export interface OpenAIEnv {
    OPENAI_API_KEY: string;
    CLOUDFLARE_ACCOUNT_ID: string;
    CLOUDFLARE_GATEWAY_ID: string;
}

/**
 * Creates a configured OpenAI client with Cloudflare AI Gateway proxy
 *
 * This utility function centralizes OpenAI client creation and ensures all
 * requests are routed through Cloudflare's AI Gateway for:
 * - Cost optimization and analytics
 * - Rate limiting and caching
 * - Request logging and monitoring
 * - Improved performance through edge routing
 *
 * @param env - Environment object containing required API keys and configuration
 * @returns Configured OpenAI client instance
 * @throws Error if required environment variables are missing
 */
export function createOpenAIClient(env: OpenAIEnv) {
    // Validate OpenAI API key
    if (!env.OPENAI_API_KEY) {
        throw new Error("OpenAI API key not found in environment variables");
    }

    // Validate Cloudflare Gateway configuration
    if (!env.CLOUDFLARE_ACCOUNT_ID || !env.CLOUDFLARE_GATEWAY_ID) {
        throw new Error("Cloudflare Gateway configuration missing");
    }

    // Create OpenAI client with Cloudflare Gateway proxy
    // Routes all OpenAI API calls through Cloudflare's edge network
    return createOpenAI({
        apiKey: env.OPENAI_API_KEY,
        baseURL: `https://gateway.ai.cloudflare.com/v1/${env.CLOUDFLARE_ACCOUNT_ID}/${env.CLOUDFLARE_GATEWAY_ID}/openai`,
    });
}
