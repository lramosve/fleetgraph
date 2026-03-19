import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { ChatAnthropic } from '@langchain/anthropic';

/**
 * LLM provider abstraction.
 *
 * Returns a BaseChatModel so graph nodes are provider-agnostic.
 * Day 1: Anthropic (Claude). Future: add OpenAI adapter by setting
 * FLEETGRAPH_LLM_PROVIDER=openai without changing any graph logic.
 */

let _llm: BaseChatModel | null = null;

function createProvider(): BaseChatModel {
  const provider = process.env.FLEETGRAPH_LLM_PROVIDER || 'anthropic';

  switch (provider) {
    case 'anthropic':
      return new ChatAnthropic({
        model: process.env.FLEETGRAPH_LLM_MODEL || 'claude-sonnet-4-20250514',
        temperature: 0,
        maxTokens: 1024,
        anthropicApiKey: process.env.ANTHROPIC_API_KEY,
      });
    // Future: case 'openai': return new ChatOpenAI({ ... });
    default:
      throw new Error(`Unknown LLM provider: ${provider}`);
  }
}

export function getLLM(): BaseChatModel {
  if (!_llm) {
    _llm = createProvider();
  }
  return _llm;
}

/** Reset the cached LLM instance (useful for testing). */
export function resetLLM(): void {
  _llm = null;
}
