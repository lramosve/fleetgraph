import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost, apiPatch, apiDelete } from '@/lib/api';

export interface Comment {
  id: string;
  document_id: string;
  comment_id: string;
  parent_id: string | null;
  content: string;
  resolved_at: string | null;
  author: {
    id: string;
    name: string;
    email?: string;
  };
  created_at: string;
  updated_at: string;
}

export function useCommentsQuery(documentId: string | undefined) {
  return useQuery<Comment[]>({
    queryKey: ['comments', documentId],
    queryFn: async () => {
      const response = await apiGet(`/api/documents/${documentId}/comments`);
      if (!response.ok) throw new Error('Failed to fetch comments');
      const data: Comment[] = await response.json();
      return data;
    },
    enabled: !!documentId,
  });
}

export function useCreateComment(documentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: { comment_id: string; content: string; parent_id?: string }) => {
      const response = await apiPost(`/api/documents/${documentId}/comments`, data);
      if (!response.ok) throw new Error('Failed to create comment');
      const comment: Comment = await response.json();
      return comment;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['comments', documentId] });
    },
  });
}

export function useUpdateComment(documentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ commentId, ...data }: { commentId: string; content?: string; resolved_at?: string | null }) => {
      const response = await apiPatch(`/api/comments/${commentId}`, data);
      if (!response.ok) throw new Error('Failed to update comment');
      const comment: Comment = await response.json();
      return comment;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['comments', documentId] });
    },
  });
}

export function useDeleteComment(documentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (commentId: string) => {
      const response = await apiDelete(`/api/comments/${commentId}`);
      if (!response.ok) throw new Error('Failed to delete comment');
      const result: { success: boolean } = await response.json();
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['comments', documentId] });
    },
  });
}
