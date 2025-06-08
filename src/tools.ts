import { z } from "zod";
import { tool } from "ai";
import Exa from "exa-js";

// Builder function to create web search tool with API key
export function createWebSearchTool(exaApiKey: string) {
  return tool({
    description: "Search the web to find relevant and up-to-date information on any topic",
    parameters: z.object({
      query: z.string().describe("The search query to find information about"),
      numResults: z.number().optional().default(5).describe("Number of results to return (default: 5)"),
      type: z.enum(["keyword", "neural", "auto"]).optional().default("auto").describe("Search type: keyword for exact match, neural for semantic search, auto for automatic selection"),
    }),
    execute: async ({ query, numResults, type }) => {
      const exa = new Exa(exaApiKey);
      
      try {
        const searchResults = await exa.searchAndContents(query, {
          type,
          numResults,
          text: true,
          livecrawl: "fallback",
        });

        return {
          success: true,
          results: searchResults.results.map(result => ({
            title: result.title,
            url: result.url,
            text: result.text,
            score: result.score,
          })),
          totalResults: searchResults.results.length,
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error occurred",
          results: [],
          totalResults: 0,
        };
      }
    },
  });
}