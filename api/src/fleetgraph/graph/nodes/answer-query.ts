import { getLLM } from '../../llm/client.js';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import type { FleetGraphStateType } from '../state.js';

export async function answerQuery(state: FleetGraphStateType): Promise<Partial<FleetGraphStateType>> {
  const { userMessage, contextData } = state;

  const llm = getLLM();

  const result = await llm.invoke([
    new SystemMessage(
      `You are FleetGraph, a project intelligence assistant for Ship (a project management platform).
You help team members understand their project state, identify risks, and take action.

You have access to the following context about the user's current workspace and document.
Answer their question concisely and actionably. If you identify risks or issues, flag them clearly.
If the user asks about stale issues, blockers, or project health, use the data provided.

Context:
${contextData}`
    ),
    new HumanMessage(userMessage),
  ]);

  const response = typeof result.content === 'string' ? result.content : JSON.stringify(result.content);

  return { response };
}
