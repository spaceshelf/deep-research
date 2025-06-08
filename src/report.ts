import { generateText } from "ai";
import pLimit from "p-limit";
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
  env: OpenAIEnv,
): Promise<string> {
  const openai = createOpenAIClient(env);

  // Create citations mapping
  const citationMap = new Map<string, number>();
  data.sources.forEach((source, index) => {
    citationMap.set(source.url, index + 1);
  });

  // Prepare sources context for AI
  const sourcesContext = data.sources
    .map(
      (source, index) => `
[${index + 1}] ${source.title}
URL: ${source.url}
Relevance: ${source.relevanceScore}/100
Query: "${source.query}"
Content: ${source.snippet}
  `,
    )
    .join("\n");

  // Generate depth-appropriate content guidance
  const depthGuidance = data.researchDepth <= 2 
    ? "Create a concise but comprehensive report with clear sections and key findings."
    : data.researchDepth <= 3
    ? "Create a detailed report with thorough analysis, multiple perspectives, and comprehensive coverage of all major aspects."
    : "Create an extensive, in-depth report with comprehensive analysis, detailed subsections, nuanced discussions, comparative analysis, and thorough exploration of all facets of the topic.";

  const sectionGuidance = data.researchDepth <= 2
    ? "Include 3-4 main sections with clear analysis."
    : data.researchDepth <= 3
    ? "Include 5-7 main sections with detailed subsections and comprehensive analysis."
    : "Include 7-10 main sections with multiple detailed subsections, comparative analysis, and extensive discussion of implications and future directions.";

  // Generate the main report content
  const reportPrompt = `You are a research analyst creating a comprehensive markdown report on "${data.originalTopic}".

Research Context:
- Research depth: ${data.researchDepth} levels (${data.researchDepth === 1 ? 'Basic' : data.researchDepth === 2 ? 'Standard' : data.researchDepth === 3 ? 'Deep' : data.researchDepth === 4 ? 'Extensive' : 'Maximum'} research)
- Total sources analyzed: ${data.totalRelevantResults}
- Research nodes explored: ${data.totalNodesExplored}

Key Insights Found:
${data.combinedInsights.map((insight, i) => `${i + 1}. ${insight}`).join("\n")}

Available Sources:
${sourcesContext}

${depthGuidance}

Create a comprehensive, well-structured markdown report that:
1. Provides an executive summary proportional to the research depth
2. ${sectionGuidance}
3. Synthesizes information across multiple sources with depth appropriate to research level
4. Includes proper citations using [number] format - ONLY use numbers 1-${data.sources.length} (available sources)
5. Identifies patterns, trends, and key findings with thorough analysis
6. Highlights any gaps or areas needing further research
7. Provides actionable conclusions and recommendations
${data.researchDepth >= 3 ? '8. Includes comparative analysis and multiple perspectives\n9. Discusses implications and future directions\n10. Provides detailed subsection analysis' : ''}

IMPORTANT CITATION RULES:
- ONLY use citation numbers from [1] to [${data.sources.length}]
- Each citation number MUST correspond to a source in the provided list
- Do NOT create citation numbers higher than [${data.sources.length}]
- If referencing multiple sources, use format like [1][2][3]
- All citations will be listed in a unified "References & Sources" section at the end

The report should be professional, insightful, and demonstrate deep understanding appropriate to the ${data.researchDepth}-level research depth.
Use markdown formatting including headers (##, ###), bullet points, and emphasis where appropriate.
Do NOT include a separate bibliography or sources section in your response - this will be automatically added.
`;

  // Scale report length based on research depth
  const baseTokens = 2000;
  const tokensPerDepth = 1500;
  const maxTokens = baseTokens + (data.researchDepth * tokensPerDepth);

  console.log(`[REPORT] Generating report with ${maxTokens} max tokens for depth ${data.researchDepth}`);

  const reportContent = await generateText({
    model: openai("o3-mini"),
    prompt: reportPrompt,
    maxTokens: maxTokens,
  });

  // Validate and fix citations in the report
  let validatedReport = reportContent.text;
  const maxCitationNumber = data.sources.length;

  console.log(
    `[REPORT] Validating citations - Max valid citation number: ${maxCitationNumber}`,
  );

  // Find all citation patterns [number] and validate them
  const citationRegex = /\[(\d+)\]/g;
  const invalidCitations: number[] = [];
  const allCitations: number[] = [];

  validatedReport = validatedReport.replace(citationRegex, (match, number) => {
    const citationNum = parseInt(number, 10);
    allCitations.push(citationNum);

    if (citationNum > maxCitationNumber || citationNum < 1) {
      invalidCitations.push(citationNum);
      // Replace with a valid citation number (cycle through available sources)
      const validNum = ((Math.abs(citationNum) - 1) % maxCitationNumber) + 1;
      console.log(
        `[REPORT] Replacing invalid citation [${citationNum}] with [${validNum}]`,
      );
      return `[${validNum}]`;
    }
    return match;
  });

  console.log(
    `[REPORT] Found ${allCitations.length} total citations: [${[...new Set(allCitations)].sort((a, b) => a - b).join(", ")}]`,
  );

  if (invalidCitations.length > 0) {
    console.log(
      `[REPORT] Fixed ${invalidCitations.length} invalid citations: [${invalidCitations.join(", ")}]`,
    );
  } else {
    console.log(`[REPORT] All citations are valid`);
  }

  // Generate the unified sources/references section
  const sourcesSection = data.sources
    .map(
      (source, index) =>
        `[${index + 1}] **${source.title}**
    *Retrieved from:* ${source.url}
    *Relevance Score:* ${source.relevanceScore}/100
    *Found via query:* "${source.query}"`,
    )
    .join("\n\n");

  // Combine everything into final report
  const finalReport = `# Research Report: ${data.originalTopic}

*Generated on ${new Date().toLocaleDateString()}*

---

${validatedReport}

## References & Sources

${sourcesSection}

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
  env: OpenAIEnv,
): Promise<string> {
  const openai = createOpenAIClient(env);

  const summaryPrompt = `Create a concise executive summary for research on "${data.originalTopic}".

Key Insights:
${data.combinedInsights.join("\n")}

Research Stats:
- ${data.sources.length} unique sources
- ${data.totalNodesExplored} research paths explored
- Average source relevance: ${Math.round(data.sources.reduce((sum, s) => sum + s.relevanceScore, 0) / data.sources.length)}%

Create a 2-3 paragraph executive summary that captures the most important findings and their implications.`;

  const summary = await generateText({
    model: openai("o3-mini"),
    prompt: summaryPrompt,
    maxTokens: 500,
  });

  return summary.text;
}
