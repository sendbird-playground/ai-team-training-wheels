import { Chat } from 'chat';
import { createSlackAdapter } from '@chat-adapter/slack';
import { createRedisState } from '@chat-adapter/state-redis';

export const chat = new Chat({
  userName: 'po-agent',
  adapters: {
    slack: createSlackAdapter(),
  },
  state: createRedisState({
    // Upstash: use the standard Redis TLS URL (rediss://default:TOKEN@host.upstash.io:6379)
    // not the REST API URL
    url: process.env.UPSTASH_REDIS_URL!,
  }),
});
