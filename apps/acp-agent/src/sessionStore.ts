export interface Session {
  id: string;
  cwd: string;
  agent: import("@ninjacode/core").Agent;
  pendingPermission?: {
    resolve: (v: { approved: boolean; remember?: boolean }) => void;
  };
}

export const sessions = new Map<string, Session>();
