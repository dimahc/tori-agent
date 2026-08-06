/**
 * Create a conversation client for the given server URL.
 * Currently a minimal stub — returns the URL wrapped in an object.
 * Will be expanded when the Conversation interface is implemented.
 */
export function createConversationClient(serverUrl: string | URL): { baseUrl: URL } {
  return { baseUrl: new URL(serverUrl) };
}
