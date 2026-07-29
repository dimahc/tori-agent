import { buildPlugin } from '@tori-agent/core';
import { createKiloCodeConversation } from './sdk-adapter.js';

const baseUrl = process.env.KILOCODE_BASE_URL ?? 'http://localhost:8080';

const conversation = createKiloCodeConversation(baseUrl);

export default buildPlugin(conversation);