# Deep Research Project Guidelines

## Project Overview
Deep Research is a platform built on Cloudflare Workers that provides AI-powered research capabilities. The system uses a combination of search engines (via Exa) and large language models (via OpenAI) to perform deep, recursive research on topics.

### Key Components
- **Research Engine**: Performs recursive, deep research by generating follow-up questions and exploring topics in depth
- **Agent System**: Uses an agent-based architecture to handle user interactions
- **Workflow System**: Manages the research process through Cloudflare Workers' workflow capabilities
- **Report Generation**: Creates comprehensive markdown reports from research findings

### Technology Stack
- **Cloudflare Workers**: Serverless platform for hosting the application
- **TypeScript**: Programming language used throughout the project
- **OpenAI API**: Used for generating insights, evaluating relevance, and creating reports
- **Exa API**: Used for web search functionality
- **Vitest**: Testing framework for unit and integration tests

## Project Structure
- `/src`: Contains all TypeScript source code
  - `index.ts`: Main entry point for the Cloudflare Workers application
  - `agent.ts`: Implementation of the ResearcherAgent
  - `workflow.ts`: Implementation of the DeepResearchWorkflow
  - `research.ts`: Core research functionality
  - `report.ts`: Report generation functionality
  - `openai.ts`: OpenAI client configuration
  - `types.ts`: TypeScript type definitions
- `/public`: Contains static assets and HTML files
- `/coverage`: Test coverage reports

## Guidelines for Junie

### Development Workflow
1. **Understanding the Code**: Before making changes, understand the research workflow and how different components interact.
2. **Testing**: Run tests using `pnpm test` to ensure changes don't break existing functionality.
3. **Local Development**: Use `pnpm dev` to run the application locally for testing.

### Code Style and Quality
1. **TypeScript**: Use proper TypeScript types and interfaces.
2. **Error Handling**: Implement robust error handling, especially for API calls.
3. **Documentation**: Maintain clear documentation in code comments.
4. **Testing**: Write tests for new functionality.

### Environment Setup
1. **API Keys**: The application requires several API keys:
   - `OPENAI_API_KEY`: For OpenAI API access
   - `EXA_API_KEY`: For Exa search API access
   - `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_GATEWAY_ID`: For Cloudflare integration
2. **Package Management**: Always use `pnpm` for package management.

### Deployment
1. **Wrangler**: Use `pnpm deploy` to deploy to Cloudflare Workers.
2. **Type Generation**: Run `pnpm cf-typegen` after modifying Wrangler configuration.

### Testing
1. **Run Tests**: Use `pnpm test` to run tests.
2. **Test Coverage**: Use `pnpm test:coverage` to generate test coverage reports.
