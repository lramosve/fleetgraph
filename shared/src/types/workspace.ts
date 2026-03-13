// Workspace types

export type WorkspaceRole = 'admin' | 'member';

export interface Workspace {
  id: string;
  name: string;
  sprintStartDate: Date;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface WorkspaceMembership {
  id: string;
  workspaceId: string;
  userId: string;
  personDocumentId: string | null;
  role: WorkspaceRole;
  createdAt: Date;
  updatedAt: Date;
}

export interface WorkspaceInvite {
  id: string;
  workspaceId: string;
  email: string;
  token: string;
  role: WorkspaceRole;
  invitedByUserId: string;
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;
}

export interface AuditLog {
  id: string;
  workspaceId: string | null;
  actorUserId: string;
  impersonatingUserId: string | null;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  details: Record<string, unknown> | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: Date;
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
  createdAt: Date;
}
