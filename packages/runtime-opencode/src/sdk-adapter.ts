export function createConversationClient(serverUrl: string | URL): { baseUrl: URL } {
  return { baseUrl: new URL(serverUrl) };
}