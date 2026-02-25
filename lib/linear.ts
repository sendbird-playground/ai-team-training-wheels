import { LinearClient } from '@linear/sdk';

let _client: LinearClient | null = null;

function getClient(): LinearClient {
  if (!_client) {
    _client = new LinearClient({ apiKey: process.env.LINEAR_API_KEY! });
  }
  return _client;
}

export interface IssueInfo {
  id: string;
  identifier: string;
  title: string;
  description: string | null | undefined;
  url: string;
  stateName: string;
}

export async function fetchIssue(identifier: string): Promise<IssueInfo | null> {
  const client = getClient();
  const issue = await client.issue(identifier);
  if (!issue) return null;

  const state = await issue.state;
  return {
    id: issue.id,
    identifier: issue.identifier,
    title: issue.title,
    description: issue.description ?? null,
    url: issue.url,
    stateName: state?.name ?? 'Unknown',
  };
}

export async function postComment(issueId: string, body: string): Promise<void> {
  const client = getClient();
  await client.createComment({ issueId, body });
}

export async function setInProgress(issueId: string): Promise<void> {
  const client = getClient();
  // Get the team's states and find one named "In Progress"
  const issue = await client.issue(issueId);
  const team = await issue.team;
  if (!team) return;

  const states = await team.states();
  const inProgress = states.nodes.find(
    (s) => s.name.toLowerCase() === 'in progress'
  );
  if (inProgress) {
    await client.updateIssue(issueId, { stateId: inProgress.id });
  }
}
