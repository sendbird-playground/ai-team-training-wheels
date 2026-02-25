import { after } from 'next/server';
import { anthropic } from '@ai-sdk/anthropic';
import { streamText, stepCountIs } from 'ai';
import type { ModelMessage } from 'ai';
import type { Thread } from 'chat';
import { readFileSync } from 'fs';
import path from 'path';
import { chat } from '@/lib/bot';
import { createNotionMCP, createLinearMCP } from '@/lib/mcp';

const PO_PROMPT = readFileSync(
  path.join(process.cwd(), 'lib/prompts/po-system.md'),
  'utf8'
);

async function buildHistory(thread: Thread): Promise<ModelMessage[]> {
  const messages: ModelMessage[] = [];
  for await (const msg of thread.allMessages) {
    if (msg.author.isMe) {
      messages.push({ role: 'assistant', content: msg.text });
    } else {
      messages.push({ role: 'user', content: msg.text });
    }
  }
  return messages;
}

async function runAgent(thread: Thread): Promise<void> {
  const [history, notionMCP, linearMCP] = await Promise.all([
    buildHistory(thread),
    createNotionMCP(),
    createLinearMCP(),
  ]);

  try {
    const result = streamText({
      model: anthropic('claude-sonnet-4-6'),
      system: PO_PROMPT,
      messages: history,
      tools: {
        ...(await notionMCP.tools()),
        ...(await linearMCP.tools()),
      },
      stopWhen: stepCountIs(10),
    });

    await thread.post(result.textStream);
  } catch (err) {
    await thread.post('Something went wrong connecting to Notion or Linear. Please try again.');
    console.error('[po-agent] error:', err);
  } finally {
    await notionMCP.close();
    await linearMCP.close();
  }
}

chat.onNewMention(async (thread) => {
  await thread.subscribe();
  await runAgent(thread);
});

chat.onSubscribedMessage(async (thread) => {
  await runAgent(thread);
});

export async function POST(request: Request) {
  return chat.webhooks.slack(request, {
    waitUntil: (p) => after(() => p),
  });
}
