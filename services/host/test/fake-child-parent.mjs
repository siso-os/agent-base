// Fake Claude SDK invokes the real in-process MCP handlers; children may use the real Codex CLI.
export async function getSessionMessages() { return []; }
export function query({ prompt, options }) {
  let closed = false, sequence = 0;
  const returns = [];
  return {
    close() { closed = true; }, supportedCommands: async () => [],
    getContextUsage: async () => ({ totalTokens: 10, maxTokens: 1000 }),
    async *[Symbol.asyncIterator]() {
      yield { type: 'system', subtype: 'init', session_id: options.resume ?? options.sessionId, model: 'fake-claude' };
      for await (const m of prompt) {
        if (closed) return;
        const body = m.message.content;
        if (body.startsWith('spawn two:')) {
          const brief = body.slice('spawn two:'.length).trim();
          const server = options.mcpServers.codex_children.instance;
          for (const name of ['CLAUDE-ONE','CLAUDE-TWO']) {
            const r = await server._registeredTools.spawn_codex.handler({ name, brief: brief.replaceAll('CHILD_NAME', name), cwd: process.cwd(), effort: 'low' }, {});
            if (r.isError) throw Error(r.content[0].text);
          }
          yield { type: 'assistant', uuid: `fake-${++sequence}`, message: { content: [{ type: 'text', text: 'Two researchers launched. Waiting for both automatic returns.' }] } };
        } else if (body.includes(' returned (')) {
          returns.push(body.match(/<output>([\s\S]*?)<\/output>/)?.[1] ?? body);
          const answer = returns.length >= 2 ? `Combined both children: ${returns.join('\n')}` : `Received one child: ${body}`;
          yield { type: 'assistant', uuid: `fake-${++sequence}`, message: { content: [{ type: 'text', text: answer }] } };
        }
        yield { type: 'result', subtype: 'success', duration_ms: 1 };
      }
    }
  };
}
