export interface CIConfig {
  provider: 'github' | 'gitlab' | 'local';
  command: string;
  poll_interval_ms: number;
  timeout_ms: number;
}

export interface CIResult {
  status: 'passed' | 'failed' | 'timeout' | 'error';
  output: string;
  duration_ms: number;
  timestamp: string;
}
