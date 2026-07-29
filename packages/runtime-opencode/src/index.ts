import { buildPlugin } from '@tori-agent/core';
import { createOpencodeConversation } from './sdk-adapter.js';

const baseUrl = process.env.OPENCODE_BASE_URL ?? 'http://localhost:8080';

const conversation = createOpencodeConversation(baseUrl);

export default buildPlugin(conversation);