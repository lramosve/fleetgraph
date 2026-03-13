// Workspace types

export type WorkspaceRole = 'admin' | 'member';

export interface Workspace {
  id: string;
  name: string;
  sprintStartDate: string;    // ISO 8601 timestamp
  archivedAt: string | null;
  createdAt: string;           // ISO 8601 timestamp
  updatedAt: string;           // ISO 8601 timestamp
}

export interface WorkspaceMembership {
  id: string;
  workspaceId: string;
  userId: string;
  personDocumentId: string | null;
  role: WorkspaceRole;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceInvite {
  id: string;
  workspaceId: string;
  email: string;
  token: string;
  role: WorkspaceRole;
  invitedByUserId: string;
  expiresAt: string;          // ISO 8601 timestamp
  usedAt: string | null;
  createdAt: string;
}

export interface AuditLog {
  id: string;
  workspaceId: string | null;
  actorUserId: string;
  impersonatingUserId: string | null;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  readonly details: Readonly<Record<string, unknown>> | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
}

// Response types
export interface WorkspaceWithRole extends Workspace {
  role: WorkspaceRole;
  isSuperAdmin?: boolean;
}

export interface MemberWithUser {
  id: string;
  userId: string;
  email: string;
  name: string;
  role: WorkspaceRole;
  personDocumentId: string | null;
  createdAt: string;
}
