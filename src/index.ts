import {
  WorkflowEntrypoint,
  WorkflowEvent,
  WorkflowStep,
} from "cloudflare:workers";
import { generateObject } from "ai";
import { z } from "zod";
import pLimit from "p-limit";
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

    console.log(
      `[WORKFLOW] Starting deep research workflow for topic: "${searchTopic}" with depth: ${researchDepth}`,
    );

    if (!searchTopic) {
      console.error("[WORKFLOW] Missing searchTopic parameter");
      throw new Error("searchTopic parameter is required");
    }

    // Step 1: Generate initial search queries
    const initialQueries = await step.do(
      "generate initial search queries",
      async () => {
        console.log("[STEP-1] Generating initial search queries");
        const openai = createOpenAIClient(this.env);

        const prompt = `Generate 3 diverse and relevant search queries for researching the topic: "${searchTopic}".
      The queries should explore different angles and aspects of the topic to get comprehensive results.`;

        console.log("[STEP-1] Sending prompt to OpenAI for query generation");
        const result = await generateObject({
          model: openai("o3-mini"),
          prompt,
          schema: z.object({
            queries: z
              .array(z.string())
              .length(3)
              .describe("3 relevant search queries"),
          }),
        });

        console.log("[STEP-1] Generated queries:", result.object.queries);

        return {
          topic: searchTopic,
          queries: result.object.queries,
        };
      },
    );

    // Step 2: Configure research parameters
    const researchConfig = await step.do(
      "configure research parameters",
      async () => {
        console.log("[STEP-2] Configuring research parameters");
        const config: ResearchConfig = {
          maxDepth: researchDepth,
          resultsPerQuery: 3, // Reduced from 5 to save storage
          followUpQuestionsPerNode: 2, // Reduced from 3 to save storage
          concurrencyLimit: 10, // Process up to 10 AI requests concurrently
          requestDelay: 1000, // 1 second delay between AI requests
        };

        console.log("[STEP-2] Research configuration:", config);
        return config;
      },
    );

    // Step 3: Perform deep research for each query
    const researchTrees = await step.do(
      "perform deep research for all queries",
      async () => {
        console.log("[STEP-3] Starting deep research for all queries");
        console.log(
          `[STEP-3] Processing ${initialQueries.queries.length} initial queries sequentially`,
        );

        // Use p-limit for initial queries with same concurrency settings
        const limit = pLimit(researchConfig.concurrencyLimit || 1);

        const treePromises = initialQueries.queries.map((query, index) =>
          limit(async () => {
            // Add delay between queries (except for first batch)
            if (
              index >= (researchConfig.concurrencyLimit || 1) &&
              (researchConfig.requestDelay || 1000) > 0
            ) {
              await new Promise((resolve) =>
                setTimeout(resolve, researchConfig.requestDelay || 1000),
              );
            }

            console.log(
              `[STEP-3] Starting research tree ${index + 1}/${initialQueries.queries.length}: "${query}"`,
            );
            const tree = await performDeepResearch(
              query,
              searchTopic,
              this.env,
              researchConfig,
              0,
            );
            return tree;
          }),
        );

        const trees = await Promise.all(treePromises);

        console.log(
          `[STEP-3] Completed deep research for all queries. Generated ${trees.length} research trees`,
        );
        return trees;
      },
    );

    // Step 4: Summarize research results
    const summaries = await step.do("summarize research results", async () => {
      console.log("[STEP-4] Summarizing research results");
      const summaryList = researchTrees.map((tree, index) => {
        console.log(
          `[STEP-4] Summarizing research tree ${index + 1}/${researchTrees.length}`,
        );
        return summarizeResearch(searchTopic, tree);
      });

      const totalNodes = summaryList.reduce(
        (sum, s) => sum + s.totalNodesExplored,
        0,
      );
      const totalSources = summaryList.reduce(
        (sum, s) => sum + s.allSources.length,
        0,
      );
      console.log(
        `[STEP-4] Summarization complete. Total nodes: ${totalNodes}, Total sources: ${totalSources}`,
      );

      return summaryList;
    });

    // Step 5: Combine and analyze all insights
    const finalAnalysis = await step.do(
      "combine and analyze insights",
      async () => {
        console.log("[STEP-5] Combining and analyzing insights");
        const combinedInsights = summaries.flatMap((s) => s.allInsights);
        const allSources = summaries.flatMap((s) => s.allSources);
        const totalNodes = summaries.reduce(
          (sum, s) => sum + s.totalNodesExplored,
          0,
        );
        const totalRelevantResults = summaries.reduce(
          (sum, s) => sum + s.totalRelevantResults,
          0,
        );

        console.log(
          `[STEP-5] Raw data: ${combinedInsights.length} total insights, ${allSources.length} total sources`,
        );

        // Remove duplicate insights
        const uniqueInsights = [...new Set(combinedInsights)];
        console.log(
          `[STEP-5] Deduplicated insights: ${uniqueInsights.length} unique insights`,
        );

        // Deduplicate sources by URL
        const sourceMap = new Map<string, SourceInfo>();
        allSources.forEach((source) => {
          const existing = sourceMap.get(source.url);
          if (!existing || source.relevanceScore > existing.relevanceScore) {
            sourceMap.set(source.url, source);
          }
        });

        // Convert map to array and sort by relevance score
        const uniqueSources = Array.from(sourceMap.values()).sort(
          (a, b) => b.relevanceScore - a.relevanceScore,
        );

        console.log(
          `[STEP-5] Deduplicated sources: ${uniqueSources.length} unique sources`,
        );
        console.log(
          `[STEP-5] Analysis stats: ${totalNodes} nodes explored, ${totalRelevantResults} relevant results`,
        );

        return {
          originalTopic: searchTopic,
          researchDepth: researchDepth,
          initialQueries: initialQueries.queries,
          // Don't store full research trees in intermediate steps to save space
          summaries: summaries.map((s) => ({
            ...s,
            researchTree: undefined, // Remove tree to save space
          })),
          combinedInsights: uniqueInsights,
          totalInsights: combinedInsights.length,
          uniqueInsights: uniqueInsights.length,
          totalNodesExplored: totalNodes,
          totalRelevantResults,
          sources: uniqueSources,
          totalSources: allSources.length,
          uniqueSources: uniqueSources.length,
        };
      },
    );

    // Step 6: Generate full markdown report
    const fullReport = await step.do("generate full markdown report", async () => {
      console.log("[STEP-6] Generating comprehensive markdown report");
      const reportData = {
        originalTopic: searchTopic,
        researchDepth: researchDepth,
        combinedInsights: finalAnalysis.combinedInsights,
        sources: finalAnalysis.sources,
        totalNodesExplored: finalAnalysis.totalNodesExplored,
        totalRelevantResults: finalAnalysis.totalRelevantResults,
      };

      console.log(
        `[STEP-6] Generating report with ${finalAnalysis.combinedInsights.length} insights and ${finalAnalysis.sources.length} sources`,
      );

      const report = await generateMarkdownReport(reportData, this.env);
      const wordCount = report.split(/\s+/).length;
      
      console.log(
        `[STEP-6] Full report generated: ${wordCount} words`,
      );
      
      return { report, wordCount };
    });
    
    // Step 7: Generate executive summary
    const executiveSummary = await step.do("generate executive summary", async () => {
      console.log("[STEP-7] Generating executive summary");
      const reportData = {
        originalTopic: searchTopic,
        researchDepth: researchDepth,
        combinedInsights: finalAnalysis.combinedInsights,
        sources: finalAnalysis.sources,
        totalNodesExplored: finalAnalysis.totalNodesExplored,
        totalRelevantResults: finalAnalysis.totalRelevantResults,
      };

      const summary = await generateReportSummary(reportData, this.env);
      
      console.log("[STEP-7] Executive summary generated");
      
      return summary;
    });

    const finalResult = {
      ...finalAnalysis,
      report: fullReport.report,
      executiveSummary: executiveSummary,
      reportMetadata: {
        wordCount: fullReport.wordCount,
        citationCount: finalAnalysis.sources.length,
        generatedAt: new Date().toISOString(),
      },
    };

    // Remove research trees from final result to prevent storage issues
    delete (finalResult as any).researchTrees;

    console.log("[WORKFLOW] Deep research workflow completed successfully");
    console.log("[WORKFLOW] Final Statistics:");
    console.log(`  Report: ${fullReport.wordCount} words`);
    console.log(`  Sources: ${finalAnalysis.uniqueSources} unique citations`);
    console.log(`  Insights: ${finalAnalysis.uniqueInsights} unique insights`);
    console.log(
      `  Nodes: ${finalAnalysis.totalNodesExplored} research nodes explored`,
    );
    console.log(`  Topic: "${searchTopic}" (depth: ${researchDepth})`);

    return finalResult;
  }
}
export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    let url = new URL(req.url);

    // Handle API routes
    if (url.pathname.startsWith("/api/research")) {
      // Get the status of an existing instance, if provided
      // GET /api/research?instanceId=<id here>
      let id = url.searchParams.get("instanceId");
      if (id) {
        console.log(`[API] Checking status for workflow instance: ${id}`);
        let instance = await env.DEEP_RESEARCH_WORKFLOW.get(id);
        const status = await instance.status();
        console.log(`[API] Instance ${id} status: ${status.status}`);
        return Response.json({
          status,
        });
      }

      // Get search topic and depth from query params
      const searchTopic = url.searchParams.get("searchTopic");
      const researchDepth = url.searchParams.get("researchDepth");

      console.log(
        `[API] New research request - Topic: "${searchTopic}", Depth: ${researchDepth || "default(2)"}`,
      );

      if (!searchTopic) {
        console.log("[API] Missing searchTopic parameter");
        return Response.json(
          { error: "searchTopic parameter is required" },
          { status: 400 },
        );
      }

      // Parse research depth if provided
      const depth = researchDepth ? parseInt(researchDepth, 10) : undefined;
      if (depth !== undefined && (isNaN(depth) || depth < 1 || depth > 5)) {
        console.log(`[API] Invalid research depth: ${researchDepth}`);
        return Response.json(
          { error: "researchDepth must be a number between 1 and 5" },
          { status: 400 },
        );
      }

      // Spawn a new instance with the search topic and optional depth
      console.log("[API] Creating new workflow instance");
      let instance = await env.DEEP_RESEARCH_WORKFLOW.create({
        params: {
          searchTopic,
          ...(depth && { researchDepth: depth }),
        },
      });

      console.log(`[API] Created workflow instance: ${instance.id}`);

      return Response.json({
        id: instance.id,
        details: await instance.status(),
      });
    }

    // All other routes will be served by static assets automatically
    return new Response("Not Found", { status: 404 });
  },
};
