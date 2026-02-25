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
import { fetchIssue, postComment, setInProgress } from '@/lib/linear';

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

    _chat.onSlashCommand('/ship', async (event) => {
      const identifier = event.text.trim().toUpperCase();
      if (!identifier) {
        await event.channel.post('Usage: `/ship SEN-XX`');
        return;
      }

      await event.channel.post(`Shipping *${identifier}*... fetching issue details.`);

      let issue;
      try {
        issue = await fetchIssue(identifier);
      } catch (err) {
        await event.channel.post(`Failed to fetch ${identifier} from Linear. Make sure LINEAR_API_KEY is set.`);
        console.error('[ship] fetchIssue error:', err);
        return;
      }

      if (!issue) {
        await event.channel.post(`Issue *${identifier}* not found in Linear.`);
        return;
      }

      // Build a rich Codex comment from the issue title + description
      const codexComment = buildCodexComment(issue.title, issue.description);

      try {
        await Promise.all([
          postComment(issue.id, codexComment),
          setInProgress(issue.id),
        ]);
      } catch (err) {
        await event.channel.post(`Failed to update Linear issue. Check bot permissions.`);
        console.error('[ship] Linear update error:', err);
        return;
      }

      await event.channel.post(
        `:rocket: *${issue.identifier}* is in progress!\n` +
        `Codex has been assigned the task. I'll notify you when a PR is up.\n` +
        `<${issue.url}|View in Linear>`
      );
    });
  }

  return _chat;
}

function buildCodexComment(title: string, description: string | null | undefined): string {
  const lines = [
    `@Codex Please implement the following:`,
    ``,
    `**${title}**`,
  ];
  if (description) {
    lines.push(``, description.trim());
  }
  lines.push(
    ``,
    `When done, open a pull request and post the PR link as a comment on this issue.`
  );
  return lines.join('\n');
}
