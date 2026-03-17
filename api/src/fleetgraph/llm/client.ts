import { ChatAnthropic } from '@langchain/anthropic';

let _llm: ChatAnthropic | null = null;

export function getLLM(): ChatAnthropic {
  if (!_llm) {
    _llm = new ChatAnthropic({
      model: 'claude-sonnet-4-20250514',
      temperature: 0,
      maxTokens: 1024,
      anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    });
  }
  return _llm;
}
