import { generateObject } from "ai";
import { z } from "zod";
import Exa, { SearchResult } from "exa-js";
import { createOpenAIClient, OpenAIEnv } from "./openai";
import {
  ResearchNode,
  ResearchConfig,
  RelevanceCheckResult,
  ResearchSummary,
  SourceInfo,
} from "./types";

interface ResearchEnv extends OpenAIEnv {
  EXA_API_KEY: string;
}

/**
 * Check if a search result is relevant to the research topic
 */
async function checkRelevance(
  result: SearchResult<any>,
  topic: string,
  query: string,
  env: ResearchEnv,
): Promise<RelevanceCheckResult> {
  const openai = createOpenAIClient(env);

  const prompt = `
    Research Topic: "${topic}"
    Search Query: "${query}"

    Result Title: ${result.title}
    Result URL: ${result.url}
    Result Content Preview: ${result.text?.substring(0, 500)}

    Determine if this search result is relevant to the research topic. Consider:
    1. Does it directly address the topic?
    2. Does it provide valuable information or insights?
    3. Is it from a credible source?
    4. Does it add new perspective or depth to the research?
  `;

  const relevanceCheck = await generateObject({
    model: openai("gpt-4o-mini"),
    prompt,
    schema: z.object({
      isRelevant: z
        .boolean()
        .describe("Whether the result is relevant to the research topic"),
      reasoning: z
        .string()
        .describe("Brief explanation of why it is or isn't relevant"),
      relevanceScore: z
        .number()
        .min(0)
        .max(100)
        .describe("Relevance score from 0-100"),
    }),
  });

  return relevanceCheck.object;
}

/**
 * Generate insights from relevant search results
 */
async function generateInsights(
  results: SearchResult<any>[],
  topic: string,
  query: string,
  env: ResearchEnv,
): Promise<string[]> {
  if (results.length === 0) return [];

  const openai = createOpenAIClient(env);

  const resultsContext = results
    .map(
      (r, i) => `
    Result ${i + 1}:
    Title: ${r.title}
    URL: ${r.url}
    Content: ${r.text?.substring(0, 800)}
  `,
    )
    .join("\n\n");

  const prompt = `
    Research Topic: "${topic}"
    Query: "${query}"

    Based on these search results:
    ${resultsContext}

    Generate 3-5 key insights that:
    1. Synthesize information across multiple sources
    2. Highlight important findings or patterns
    3. Identify unique perspectives or controversies
    4. Note any gaps or areas needing further research
  `;

  const insights = await generateObject({
    model: openai("gpt-4o-mini"),
    prompt,
    schema: z.object({
      insights: z
        .array(z.string())
        .min(3)
        .max(5)
        .describe("Key insights from the search results"),
    }),
  });

  return insights.object.insights;
}

/**
 * Generate follow-up questions based on insights and current research
 */
async function generateFollowUpQuestions(
  node: ResearchNode,
  topic: string,
  env: ResearchEnv,
  count: number = 3,
): Promise<string[]> {
  const openai = createOpenAIClient(env);

  const prompt = `
    Research Topic: "${topic}"
    Current Query: "${node.query}"

    Current Insights:
    ${node.insights.join("\n")}

    Based on these insights, generate ${count} follow-up questions that:
    1. Explore areas that need deeper investigation
    2. Address gaps or uncertainties in the current findings
    3. Investigate different angles or perspectives
    4. Build upon interesting discoveries

    Make the questions specific and searchable.
  `;

  const questions = await generateObject({
    model: openai("gpt-4o-mini"),
    prompt,
    schema: z.object({
      questions: z
        .array(z.string())
        .length(count)
        .describe(`${count} follow-up research questions`),
    }),
  });

  return questions.object.questions;
}

/**
 * Perform deep research recursively
 */
export async function performDeepResearch(
  query: string,
  topic: string,
  env: ResearchEnv,
  config: ResearchConfig,
  currentDepth: number = 0,
): Promise<ResearchNode> {
  const exa = new Exa(env.EXA_API_KEY);

  // Initialize the research node
  const node: ResearchNode = {
    query,
    searchResults: [],
    relevantResults: [],
    relevanceScores: {},
    insights: [],
    followUpQuestions: [],
    depth: currentDepth,
    children: [],
  };

  // Perform the search
  const searchResult = await exa.searchAndContents(query, {
    text: true,
    livecrawl: "fallback",
    numResults: config.resultsPerQuery,
  });

  node.searchResults = searchResult.results;

  // Check relevance for each result
  const relevanceChecks = await Promise.all(
    node.searchResults.map((result) =>
      checkRelevance(result, topic, query, env),
    ),
  );

  // Store relevance scores and filter relevant results
  node.searchResults.forEach((result, index) => {
    const relevance = relevanceChecks[index];
    node.relevanceScores[result.url] = relevance.relevanceScore;
  });

  // Filter relevant results
  node.relevantResults = node.searchResults.filter(
    (_result, index) =>
      relevanceChecks[index].isRelevant &&
      relevanceChecks[index].relevanceScore >= 70,
  );

  // Generate insights from relevant results
  if (node.relevantResults.length > 0) {
    node.insights = await generateInsights(
      node.relevantResults,
      topic,
      query,
      env,
    );

    // Generate follow-up questions if not at max depth
    if (currentDepth < config.maxDepth - 1) {
      node.followUpQuestions = await generateFollowUpQuestions(
        node,
        topic,
        env,
        config.followUpQuestionsPerNode,
      );

      // Recursively research each follow-up question
      node.children = await Promise.all(
        node.followUpQuestions.map((followUpQuery) =>
          performDeepResearch(
            followUpQuery,
            topic,
            env,
            config,
            currentDepth + 1,
          ),
        ),
      );
    }
  }

  return node;
}

/**
 * Summarize the research tree
 */
export function summarizeResearch(
  topic: string,
  researchTree: ResearchNode,
): ResearchSummary {
  const allInsights: string[] = [];
  const allSources: SourceInfo[] = [];
  let totalNodes = 0;
  let totalRelevantResults = 0;

  // Recursive function to collect data from all nodes
  function collectFromNode(node: ResearchNode) {
    totalNodes++;
    totalRelevantResults += node.relevantResults.length;
    allInsights.push(...node.insights);

    // Collect sources from this node
    node.relevantResults.forEach((result) => {
      const relevanceScore = node.relevanceScores[result.url] || 0;
      allSources.push({
        title: result.title || "Untitled",
        url: result.url,
        snippet: result.text?.substring(0, 300) || "",
        query: node.query,
        relevanceScore,
      });
    });

    // Recursively collect from children
    node.children.forEach((child) => collectFromNode(child));
  }

  collectFromNode(researchTree);

  return {
    originalTopic: topic,
    totalNodesExplored: totalNodes,
    totalRelevantResults,
    allInsights,
    allSources,
    researchTree,
  };
}
