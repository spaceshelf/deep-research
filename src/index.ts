import {
  WorkflowEntrypoint,
  WorkflowEvent,
  WorkflowStep,
} from "cloudflare:workers";
import Exa from "exa-js";
import { generateObject } from "ai";
import { z } from "zod";
import { createOpenAIClient } from "./openai";
import { performDeepResearch, summarizeResearch } from "./research";
import { ResearchConfig, SourceInfo } from "./types";
import { generateMarkdownReport, generateReportSummary } from "./report";

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
  researchDepth?: number;
};

export class DeepResearchWorkflow extends WorkflowEntrypoint<Env, Params> {
  async run(event: WorkflowEvent<Params>, step: WorkflowStep) {
    const { searchTopic, researchDepth = 2 } = event.payload;
    
    if (!searchTopic) {
      throw new Error("searchTopic parameter is required");
    }
    
    // Step 1: Generate initial search queries
    const initialQueries = await step.do("generate initial search queries", async () => {
      const openai = createOpenAIClient(this.env);
      
      const prompt = `Generate 3 diverse and relevant search queries for researching the topic: "${searchTopic}". 
      The queries should explore different angles and aspects of the topic to get comprehensive results.`;
      
      const result = await generateObject({
        model: openai("gpt-4o-mini"),
        prompt,
        schema: z.object({
          queries: z.array(z.string()).length(3).describe("3 relevant search queries"),
        }),
      });
      
      return {
        topic: searchTopic,
        queries: result.object.queries,
      };
    });
    
    // Step 2: Configure research parameters
    const researchConfig = await step.do("configure research parameters", async () => {
      const config: ResearchConfig = {
        maxDepth: researchDepth,
        resultsPerQuery: 5,
        followUpQuestionsPerNode: 3,
      };
      
      return config;
    });
    
    // Step 3: Perform deep research for each query
    const researchTrees = await step.do("perform deep research for all queries", async () => {
      const trees = await Promise.all(
        initialQueries.queries.map(query =>
          performDeepResearch(query, searchTopic, this.env, researchConfig, 0)
        )
      );
      
      return trees;
    });
    
    // Step 4: Summarize research results
    const summaries = await step.do("summarize research results", async () => {
      const summaryList = researchTrees.map(tree => 
        summarizeResearch(searchTopic, tree)
      );
      
      return summaryList;
    });
    
    // Step 5: Combine and analyze all insights
    const finalAnalysis = await step.do("combine and analyze insights", async () => {
      const combinedInsights = summaries.flatMap(s => s.allInsights);
      const allSources = summaries.flatMap(s => s.allSources);
      const totalNodes = summaries.reduce((sum, s) => sum + s.totalNodesExplored, 0);
      const totalRelevantResults = summaries.reduce((sum, s) => sum + s.totalRelevantResults, 0);
      
      // Remove duplicate insights
      const uniqueInsights = [...new Set(combinedInsights)];
      
      // Deduplicate sources by URL
      const sourceMap = new Map<string, SourceInfo>();
      allSources.forEach(source => {
        const existing = sourceMap.get(source.url);
        if (!existing || source.relevanceScore > existing.relevanceScore) {
          sourceMap.set(source.url, source);
        }
      });
      
      // Convert map to array and sort by relevance score
      const uniqueSources = Array.from(sourceMap.values())
        .sort((a, b) => b.relevanceScore - a.relevanceScore);
      
      return {
        originalTopic: searchTopic,
        researchDepth: researchDepth,
        initialQueries: initialQueries.queries,
        researchTrees,
        summaries,
        combinedInsights: uniqueInsights,
        totalInsights: combinedInsights.length,
        uniqueInsights: uniqueInsights.length,
        totalNodesExplored: totalNodes,
        totalRelevantResults,
        sources: uniqueSources,
        totalSources: allSources.length,
        uniqueSources: uniqueSources.length,
      };
    });
    
    // Step 6: Generate comprehensive markdown report
    const report = await step.do("generate markdown report", async () => {
      const reportData = {
        originalTopic: searchTopic,
        researchDepth: researchDepth,
        combinedInsights: finalAnalysis.combinedInsights,
        sources: finalAnalysis.sources,
        totalNodesExplored: finalAnalysis.totalNodesExplored,
        totalRelevantResults: finalAnalysis.totalRelevantResults,
      };
      
      const [fullReport, executiveSummary] = await Promise.all([
        generateMarkdownReport(reportData, this.env),
        generateReportSummary(reportData, this.env)
      ]);
      
      return {
        fullReport,
        executiveSummary,
        wordCount: fullReport.split(/\s+/).length,
        citationCount: finalAnalysis.sources.length,
      };
    });
    
    return {
      ...finalAnalysis,
      report: report.fullReport,
      executiveSummary: report.executiveSummary,
      reportMetadata: {
        wordCount: report.wordCount,
        citationCount: report.citationCount,
        generatedAt: new Date().toISOString(),
      }
    };
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

    // Get search topic and depth from query params
    const searchTopic = url.searchParams.get("searchTopic");
    const researchDepth = url.searchParams.get("researchDepth");
    
    if (!searchTopic) {
      return Response.json({ error: "searchTopic parameter is required" }, { status: 400 });
    }
    
    // Parse research depth if provided
    const depth = researchDepth ? parseInt(researchDepth, 10) : undefined;
    if (depth !== undefined && (isNaN(depth) || depth < 1 || depth > 5)) {
      return Response.json({ error: "researchDepth must be a number between 1 and 5" }, { status: 400 });
    }
    
    // Spawn a new instance with the search topic and optional depth
    let instance = await env.DEEP_RESEARCH_WORKFLOW.create({
      params: { 
        searchTopic,
        ...(depth && { researchDepth: depth })
      },
    });
    
    return Response.json({
      id: instance.id,
      details: await instance.status(),
    });
  },
};
