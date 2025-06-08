import {
  WorkflowEntrypoint,
  WorkflowEvent,
  WorkflowStep,
} from "cloudflare:workers";
import Exa from "exa-js";
import { createOpenAI } from "@ai-sdk/openai";
import { generateObject } from "ai";
import { z } from "zod";

/**
 * Welcome to Cloudflare Workers! This is your first Workflows application.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your Workflow in action
 * - Run `npm run deploy` to publish your application
 *
 * Learn more at https://developers.cloudflare.com/workflows
 */

// Define the environment interface
interface Env {
  DEEP_RESEARCH_WORKFLOW: Workflow;
  EXA_API_KEY: string;
  OPENAI_API_KEY: string;
  CLOUDFLARE_ACCOUNT_ID: string;
  CLOUDFLARE_GATEWAY_ID: string;
}

// User-defined params passed to your Workflow
type Params = {
  searchTopic: string;
};

export class DeepResearchWorkflow extends WorkflowEntrypoint<Env, Params> {
  async run(event: WorkflowEvent<Params>, step: WorkflowStep) {
    const { searchTopic } = event.payload;
    
    if (!searchTopic) {
      throw new Error("searchTopic parameter is required");
    }
    
    // Generate relevant search queries using OpenAI
    const searchQueries = await step.do("generate relevant search queries", async () => {
      if (!this.env.OPENAI_API_KEY) {
        throw new Error("OPENAI_API_KEY environment variable is required");
      }
      
      if (!this.env.CLOUDFLARE_ACCOUNT_ID || !this.env.CLOUDFLARE_GATEWAY_ID) {
        throw new Error("Cloudflare Gateway configuration missing");
      }
      
      // Create OpenAI client with Cloudflare Gateway proxy
      const openai = createOpenAI({
        apiKey: this.env.OPENAI_API_KEY,
        baseURL: `https://gateway.ai.cloudflare.com/v1/${this.env.CLOUDFLARE_ACCOUNT_ID}/${this.env.CLOUDFLARE_GATEWAY_ID}/openai`,
      });
      
      const prompt = `Generate 5 diverse and relevant search queries for researching the topic: "${searchTopic}". 
      The queries should explore different angles and aspects of the topic to get comprehensive results.`;
      
      const result = await generateObject({
        model: openai("gpt-4o-mini"),
        prompt,
        schema: z.object({
          queries: z.array(z.string()).length(5).describe("5 relevant search queries"),
        }),
      });
      
      return {
        originalTopic: searchTopic,
        queries: result.object.queries,
      };
    });
    
    // Initialize Exa AI and perform searches for all queries
    const searchResults = await step.do("search with exa ai", async () => {
      if (!this.env.EXA_API_KEY) {
        throw new Error("EXA_API_KEY environment variable is required");
      }
      
      const exa = new Exa(this.env.EXA_API_KEY);
      
      // Search for each generated query
      const allResults = await Promise.all(
        searchQueries.queries.map(async (query) => {
          const result = await exa.searchAndContents(
            query,
            {
              text: true,
              livecrawl: "fallback",
              numResults: 3, // Get top 3 results per query
            }
          );
          return {
            query,
            results: result.results,
          };
        })
      );
      
      return {
        originalTopic: searchTopic,
        searchQueries: searchQueries,
        searchResults: allResults,
        totalResults: allResults.reduce((sum, r) => sum + r.results.length, 0),
      };
    });
    
    return searchResults;
  }
}
export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    let url = new URL(req.url);

    if (url.pathname.startsWith("/favicon")) {
      return Response.json({}, { status: 404 });
    }

    // Get the status of an existing instance, if provided
    // GET /?instanceId=<id here>
    let id = url.searchParams.get("instanceId");
    if (id) {
      let instance = await env.DEEP_RESEARCH_WORKFLOW.get(id);
      return Response.json({
        status: await instance.status(),
      });
    }

    // Get search topic from query params
    const searchTopic = url.searchParams.get("searchTopic");
    
    if (!searchTopic) {
      return Response.json({ error: "searchTopic parameter is required" }, { status: 400 });
    }
    
    // Spawn a new instance with the search topic
    let instance = await env.DEEP_RESEARCH_WORKFLOW.create({
      params: { searchTopic },
    });
    
    return Response.json({
      id: instance.id,
      details: await instance.status(),
    });
  },
};
