import { after } from 'next/server';
import { getChat } from '@/lib/bot';

export async function POST(request: Request) {
  return getChat().webhooks.slack(request, {
    waitUntil: (p) => after(() => p),
  });
}
