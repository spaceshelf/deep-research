// Lightweight version of search result for storage optimization
export interface LightweightSearchResult {
    title: string;
    url: string;
    snippet: string; // Limited to 300 chars
    score?: number;
}

export interface ResearchNode {
    query: string;
    searchResults: LightweightSearchResult[]; // Store only essential data
    relevantResults: LightweightSearchResult[]; // Store only essential data
    relevanceScores: Record<string, number>; // URL to relevance score mapping
    insights: string[];
    followUpQuestions: string[];
    depth: number;
    children: ResearchNode[];
}

export interface ResearchConfig {
    maxDepth: number; // Controls how deep the research tree goes (depth 0 = initial queries, depth 1+ = follow-ups)
    resultsPerQuery: number;
    followUpQuestionsPerNode: number;
    concurrencyLimit?: number; // Number of concurrent AI requests (default: 1)
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
