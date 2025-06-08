import { generateText } from "ai";
import { createOpenAIClient, OpenAIEnv } from "./openai";
import { SourceInfo } from "./types";

interface ReportData {
  originalTopic: string;
  researchDepth: number;
  combinedInsights: string[];
  sources: SourceInfo[];
  totalNodesExplored: number;
  totalRelevantResults: number;
}

/**
 * Generate a comprehensive markdown report from research data
 */
export async function generateMarkdownReport(
  data: ReportData,
  env: OpenAIEnv
): Promise<string> {
  const openai = createOpenAIClient(env);
  
  // Create citations mapping
  const citationMap = new Map<string, number>();
  data.sources.forEach((source, index) => {
    citationMap.set(source.url, index + 1);
  });
  
  // Prepare sources context for AI
  const sourcesContext = data.sources.map((source, index) => `
[${index + 1}] ${source.title}
URL: ${source.url}
Relevance: ${source.relevanceScore}/100
Query: "${source.query}"
Content: ${source.snippet}
  `).join('\n');
  
  // Generate the main report content
  const reportPrompt = `You are a research analyst creating a comprehensive markdown report on "${data.originalTopic}".

Research Context:
- Research depth: ${data.researchDepth} levels
- Total sources analyzed: ${data.totalRelevantResults}
- Research nodes explored: ${data.totalNodesExplored}

Key Insights Found:
${data.combinedInsights.map((insight, i) => `${i + 1}. ${insight}`).join('\n')}

Available Sources:
${sourcesContext}

Create a comprehensive, well-structured markdown report that:
1. Provides an executive summary
2. Organizes insights into logical sections with clear headings
3. Synthesizes information across multiple sources
4. Includes proper citations using [number] format
5. Identifies patterns, trends, and key findings
6. Highlights any gaps or areas needing further research
7. Provides actionable conclusions

The report should be professional, insightful, and demonstrate deep understanding of the topic.
Use markdown formatting including headers (##, ###), bullet points, and emphasis where appropriate.
Cite sources frequently using the [number] format corresponding to the source list.
`;

  const reportContent = await generateText({
    model: openai("gpt-4o"),
    prompt: reportPrompt,
    maxTokens: 4000,
  });
  
  // Generate the bibliography
  const bibliography = data.sources.map((source, index) => 
    `[${index + 1}] ${source.title}. Retrieved from ${source.url} (Relevance: ${source.relevanceScore}/100)`
  ).join('\n');
  
  // Combine everything into final report
  const finalReport = `# Research Report: ${data.originalTopic}

*Generated on ${new Date().toLocaleDateString()}*

---

${reportContent.text}

## Sources

${bibliography}

---

### Research Methodology

This report was generated through a ${data.researchDepth}-level deep research process that:
- Explored ${data.totalNodesExplored} research nodes
- Analyzed ${data.totalRelevantResults} relevant sources
- Used AI-powered relevance scoring (70+ threshold)
- Generated follow-up questions for comprehensive coverage

*Report generated using AI-powered research workflow*`;

  return finalReport;
}

/**
 * Generate a summary report with key statistics
 */
export async function generateReportSummary(
  data: ReportData,
  env: OpenAIEnv
): Promise<string> {
  const openai = createOpenAIClient(env);
  
  const summaryPrompt = `Create a concise executive summary for research on "${data.originalTopic}".

Key Insights:
${data.combinedInsights.join('\n')}

Research Stats:
- ${data.sources.length} unique sources
- ${data.totalNodesExplored} research paths explored
- Average source relevance: ${Math.round(data.sources.reduce((sum, s) => sum + s.relevanceScore, 0) / data.sources.length)}%

Create a 2-3 paragraph executive summary that captures the most important findings and their implications.`;

  const summary = await generateText({
    model: openai("gpt-4o-mini"),
    prompt: summaryPrompt,
    maxTokens: 500,
  });
  
  return summary.text;
}