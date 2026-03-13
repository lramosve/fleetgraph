// User types
export interface User {
  id: string;
  email: string;
  name: string;
  isSuperAdmin: boolean;
  lastWorkspaceId: string | null;
  createdAt: string;   // ISO 8601 timestamp
  updatedAt: string;   // ISO 8601 timestamp
}
