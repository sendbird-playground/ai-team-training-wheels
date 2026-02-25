import { createMCPClient } from '@ai-sdk/mcp';

export async function createNotionMCP() {
  return createMCPClient({
    transport: {
      type: 'sse',
      url: 'https://mcp.notion.com/sse',
      headers: {
        Authorization: `Bearer ${process.env.NOTION_MCP_TOKEN}`,
      },
    },
  });
}

export async function createLinearMCP() {
  return createMCPClient({
    transport: {
      type: 'http',
      url: 'https://mcp.linear.app/mcp',
      headers: {
        Authorization: `Bearer ${process.env.LINEAR_MCP_TOKEN}`,
      },
    },
  });
}
