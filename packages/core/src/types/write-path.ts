export type WriteTier = 'restricted' | 'standard' | 'full';

export interface WritePolicy {
  tier: WriteTier;
  allow_paths: string[];
  deny_paths: string[];
}

export interface WritePolicyResult {
  tier: WriteTier;
  policy: WritePolicy;
}
