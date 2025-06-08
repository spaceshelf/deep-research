import { SearchResult } from "exa-js";

export interface ResearchNode {
  query: string;
  searchResults: SearchResult<any>[];
  relevantResults: SearchResult<any>[];
  relevanceScores: Record<string, number>; // URL to relevance score mapping
  insights: string[];
  followUpQuestions: string[];
  depth: number;
  children: ResearchNode[];
}

export interface ResearchConfig {
  maxDepth: number;
  resultsPerQuery: number;
  followUpQuestionsPerNode: number;
}

export interface RelevanceCheckResult {
  isRelevant: boolean;
  reasoning: string;
  relevanceScore: number;
}

export interface SourceInfo {
  title: string;
  url: string;
  snippet: string;
  query: string;
  relevanceScore: number;
}

export interface ResearchSummary {
  originalTopic: string;
  totalNodesExplored: number;
  totalRelevantResults: number;
  allInsights: string[];
  allSources: SourceInfo[];
  researchTree: ResearchNode;
}