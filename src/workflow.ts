/**
 * DeepResearchWorkflow - AI-powered research orchestration system
 * 
 * Implements a 7-step research process using OpenAI o3-mini and Exa AI:
 * 1. Generate diverse search queries from research topic
 * 2. Configure research parameters based on depth (1-5)
 * 3. Perform recursive deep research with p-limit concurrency control
 * 4. Summarize and flatten research tree into analyzable data
 * 5. Combine insights and deduplicate sources by relevance
 * 6. Generate comprehensive markdown report with validated citations
 * 7. Create executive summary of key findings
 * 
 * Features:
 * - Intelligent scaling: depth 1 (basic) to 5 (comprehensive)
 * - AI relevance scoring (70+ threshold for source inclusion)
 * - Automatic citation validation and correction
 * - Concurrency control to prevent API rate limiting
 * - Complete research methodology transparency
 * 
 * Performance: ~1-30 minutes depending on depth, produces 1000-8000+ word reports
 */

import { WorkflowEntrypoint, WorkflowEvent, WorkflowStep } from "cloudflare:workers";
import { generateObject } from "ai";
import { z } from "zod";
import pLimit from "p-limit";
import { createOpenAIClient, OpenAIEnv } from "./openai";
import { performDeepResearch, summarizeResearch } from "./research";
import { ResearchConfig, SourceInfo } from "./types";
import { generateMarkdownReport, generateReportSummary } from "./report";

/** 
 * Schema defining the complete output structure of the DeepResearchWorkflow
 * Used for type safety and validation of workflow results
 */
export const WorkflowOutputSchema = z.object({
    originalTopic: z.string().describe("The original research topic that was requested"),
    researchDepth: z.number().describe("The depth level used for the research (1-5)"),
    initialQueries: z.array(z.string()).describe("Initial search queries generated from the topic"),
    combinedInsights: z.array(z.string()).describe("All unique insights discovered during research"),
    uniqueInsights: z.number().describe("Total count of unique insights found"),
    totalNodesExplored: z.number().describe("Total number of search nodes explored"),
    totalRelevantResults: z.number().describe("Total number of relevant search results found"),
    sources: z.array(
        z.object({
            title: z.string().describe("Title of the source document"),
            url: z.string().describe("URL of the source document"),
            snippet: z.string().describe("Relevant excerpt from the source"),
            relevanceScore: z.number().describe("Relevance score (0-1) for this source"),
        })
    ).describe("Array of all sources used in the research"),
    uniqueSources: z.number().describe("Total count of unique sources analyzed"),
    report: z.string().describe("Complete markdown research report"),
    executiveSummary: z.string().describe("Executive summary of the research findings"),
    reportMetadata: z.object({
        wordCount: z.number().describe("Total word count of the generated report"),
        citationCount: z.number().describe("Number of citations included in the report"),
        generatedAt: z.string().describe("ISO timestamp when the report was generated"),
    }).describe("Metadata about the generated report"),
});

export type WorkflowOutput = z.infer<typeof WorkflowOutputSchema>;

/** Environment interface extending OpenAI environment with additional API keys */
interface Env extends OpenAIEnv {
    EXA_API_KEY: string;
    CLOUDFLARE_ACCOUNT_ID: string;
    CLOUDFLARE_GATEWAY_ID: string;
}

/** Parameters for the workflow */
type Params = {
    searchTopic: string;
    researchDepth?: number;
};

/**
 * DeepResearchWorkflow - Main workflow class for orchestrating research operations
 * 
 * This workflow combines multiple AI models and search engines to produce
 * comprehensive research reports with proper citations and analysis.
 */
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
        const initialQueries = await step.do("generate initial search queries", async () => {
            console.log("[STEP-1] Generating initial search queries");
            const openai = createOpenAIClient(this.env);

            const prompt = `Generate 3 diverse and relevant search queries for researching the topic: "${searchTopic}".
      The queries should explore different angles and aspects of the topic to get comprehensive results.`;

            console.log("[STEP-1] Sending prompt to OpenAI for query generation");
            const result = await generateObject({
                model: openai("o3-mini"),
                prompt,
                schema: z.object({
                    queries: z.array(z.string()).length(3).describe("3 relevant search queries"),
                }),
            });

            console.log("[STEP-1] Generated queries:", result.object.queries);

            return {
                topic: searchTopic,
                queries: result.object.queries,
            };
        });

        // Step 2: Configure research parameters
        const researchConfig = await step.do("configure research parameters", async () => {
            console.log("[STEP-2] Configuring research parameters");
            const config: ResearchConfig = {
                maxDepth: researchDepth,
                resultsPerQuery: 3, // Reduced from 5 to save storage
                followUpQuestionsPerNode: 2, // Reduced from 3 to save storage
                concurrencyLimit: 10, // Process up to 10 AI requests concurrently
            };

            console.log("[STEP-2] Research configuration:", config);
            return config;
        });

        // Step 3: Perform deep research for each query
        const researchTrees = await step.do("perform deep research for all queries", async () => {
            console.log("[STEP-3] Starting deep research for all queries");
            console.log(
                `[STEP-3] Processing ${initialQueries.queries.length} initial queries sequentially`,
            );

            // Use p-limit for initial queries with same concurrency settings
            const limit = pLimit(researchConfig.concurrencyLimit || 1);

            const treePromises = initialQueries.queries.map((query, index) =>
                limit(async () => {
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
        });

        // Step 4: Summarize research results
        const summaries = await step.do("summarize research results", async () => {
            console.log("[STEP-4] Summarizing research results");
            const summaryList = researchTrees.map((tree, index) => {
                console.log(
                    `[STEP-4] Summarizing research tree ${index + 1}/${researchTrees.length}`,
                );
                return summarizeResearch(searchTopic, tree);
            });

            const totalNodes = summaryList.reduce((sum, s) => sum + s.totalNodesExplored, 0);
            const totalSources = summaryList.reduce((sum, s) => sum + s.allSources.length, 0);
            console.log(
                `[STEP-4] Summarization complete. Total nodes: ${totalNodes}, Total sources: ${totalSources}`,
            );

            return summaryList;
        });

        // Step 5: Combine and analyze all insights
        const finalAnalysis = await step.do("combine and analyze insights", async () => {
            console.log("[STEP-5] Combining and analyzing insights");
            const combinedInsights = summaries.flatMap((s) => s.allInsights);
            const allSources = summaries.flatMap((s) => s.allSources);
            const totalNodes = summaries.reduce((sum, s) => sum + s.totalNodesExplored, 0);
            const totalRelevantResults = summaries.reduce(
                (sum, s) => sum + s.totalRelevantResults,
                0,
            );

            console.log(
                `[STEP-5] Raw data: ${combinedInsights.length} total insights, ${allSources.length} total sources`,
            );

            // Remove duplicate insights
            const uniqueInsights = [...new Set(combinedInsights)];
            console.log(`[STEP-5] Deduplicated insights: ${uniqueInsights.length} unique insights`);

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

            console.log(`[STEP-5] Deduplicated sources: ${uniqueSources.length} unique sources`);
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
        });

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

            console.log(`[STEP-6] Full report generated: ${wordCount} words`);

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

        // Construct final result using WorkflowOutputSchema structure
        const finalResult: WorkflowOutput = {
            originalTopic: finalAnalysis.originalTopic,
            researchDepth: finalAnalysis.researchDepth,
            initialQueries: finalAnalysis.initialQueries,
            combinedInsights: finalAnalysis.combinedInsights,
            uniqueInsights: finalAnalysis.uniqueInsights,
            totalNodesExplored: finalAnalysis.totalNodesExplored,
            totalRelevantResults: finalAnalysis.totalRelevantResults,
            sources: finalAnalysis.sources,
            uniqueSources: finalAnalysis.uniqueSources,
            report: fullReport.report,
            executiveSummary: executiveSummary,
            reportMetadata: {
                wordCount: fullReport.wordCount,
                citationCount: finalAnalysis.sources.length,
                generatedAt: new Date().toISOString(),
            },
        };

        // Validate the final result against the schema
        const validationResult = WorkflowOutputSchema.safeParse(finalResult);
        if (!validationResult.success) {
            console.error("[WORKFLOW] Final result validation failed:", validationResult.error);
            throw new Error("Workflow output validation failed");
        }

        console.log("[WORKFLOW] Deep research workflow completed successfully");
        console.log("[WORKFLOW] Final Statistics:");
        console.log(`  Report: ${finalResult.reportMetadata.wordCount} words`);
        console.log(`  Sources: ${finalResult.uniqueSources} unique citations`);
        console.log(`  Insights: ${finalResult.uniqueInsights} unique insights`);
        console.log(`  Nodes: ${finalResult.totalNodesExplored} research nodes explored`);
        console.log(`  Topic: "${finalResult.originalTopic}" (depth: ${finalResult.researchDepth})`);

        return validationResult.data;
    }
}