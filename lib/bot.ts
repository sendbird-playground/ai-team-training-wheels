import { Chat } from 'chat';
import { createSlackAdapter } from '@chat-adapter/slack';
import { createRedisState } from '@chat-adapter/state-redis';

export const chat = new Chat({
  userName: 'po-agent',
  adapters: {
    slack: createSlackAdapter(),
  },
  state: createRedisState({
    // Vercel KV provides KV_URL as a standard Redis TLS URL
    // Set it up at vercel.com/dashboard → Storage → Create KV Store
    url: process.env.KV_URL!,
  }),
});
