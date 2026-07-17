import { tool } from '@langchain/core/tools';
import type { ToolweaveRuntime } from '../runtime';

/**
 * Expose a toolweave runtime as a LangChain/LangGraph structured tool.
 *
 * Bind the returned tool to any LangGraph agent (e.g. createReactAgent):
 * the agent's own tool loop delivers type-check diagnostics back to the
 * model and re-invokes the tool with the repaired program — toolweave never
 * talks to the LLM itself.
 */
export function asLangGraphTool(runtime: ToolweaveRuntime) {
  const descriptor = runtime.asTool();
  return tool(async (input) => descriptor.execute(input as { code: string }), {
    name: descriptor.name,
    description: descriptor.description,
    schema: descriptor.inputSchema,
  });
}
