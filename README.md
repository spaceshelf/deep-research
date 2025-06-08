# Deep Research

AI-powered deep research tool using recursive questioning and relevance scoring.

## Local Development

1. Install dependencies:
```bash
pnpm install
```

2. Set up environment variables in `.dev.vars`:
```
OPENAI_API_KEY=your_openai_api_key
EXA_API_KEY=your_exa_api_key
CLOUDFLARE_ACCOUNT_ID=your_cloudflare_account_id
CLOUDFLARE_GATEWAY_ID=your_gateway_id
```

3. Start development server:
```bash
pnpm run dev
```

4. Open http://localhost:8787 to test the application

## Deployment

```bash
pnpm run deploy
```

## Live Demo

https://deep-research.claudemiro.workers.dev