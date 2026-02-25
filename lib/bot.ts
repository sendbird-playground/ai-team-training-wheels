import { Chat } from 'chat';
import { createSlackAdapter } from '@chat-adapter/slack';
import { createRedisState } from '@chat-adapter/state-redis';
import { anthropic } from '@ai-sdk/anthropic';
import { streamText, stepCountIs } from 'ai';
import type { ModelMessage } from 'ai';
import type { Thread, Message } from 'chat';
import { readFileSync } from 'fs';
import path from 'path';
import { createNotionMCP, createLinearMCP } from '@/lib/mcp';

const PO_PROMPT = readFileSync(
  path.join(process.cwd(), 'lib/prompts/po-system.md'),
  'utf8'
);

const ALLOWED_CHANNEL_ID = process.env.SLACK_ALLOWED_CHANNEL_ID;

function isAllowed(thread: Thread, message: Message): boolean {
  if (ALLOWED_CHANNEL_ID && thread.channelId !== ALLOWED_CHANNEL_ID) {
    console.warn(`[po-agent] ignored message from unauthorized channel: ${thread.channelId}`);
    return false;
  }
  return true;
}

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

// Lazy singleton — only initialized on first real request, not at build time
let _chat: Chat | null = null;

export function getChat(): Chat {
  if (!_chat) {
    _chat = new Chat({
      userName: 'po-agent',
      adapters: { slack: createSlackAdapter() },
      state: createRedisState({ url: process.env.REDIS_URL! }),
    });

    _chat.onNewMention(async (thread, message) => {
      if (!isAllowed(thread, message)) return;
      await thread.subscribe();
      await runAgent(thread);
    });

    _chat.onSubscribedMessage(async (thread, message) => {
      if (!isAllowed(thread, message)) return;
      await runAgent(thread);
    });
  }

  return _chat;
}
