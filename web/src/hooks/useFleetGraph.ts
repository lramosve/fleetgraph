import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost } from '@/lib/api';

interface Finding {
  id: string;
  finding_type: string;
  severity: string;
  document_id: string | null;
  document_type: string | null;
  summary: string;
  details: Record<string, unknown>;
  proposed_action: string;
  status: string;
  created_at: string;
}

interface FleetGraphStatus {
  enabled: boolean;
  lastPoll: string | null;
  lastSlowPoll: string | null;
  pendingCount: number;
}

export const fleetgraphKeys = {
  all: ['fleetgraph'] as const,
  findings: (status?: string) => [...fleetgraphKeys.all, 'findings', status ?? 'pending'] as const,
  status: () => [...fleetgraphKeys.all, 'status'] as const,
};

export function useFleetGraphFindings(status = 'pending') {
  return useQuery<{ findings: Finding[] }>({
    queryKey: fleetgraphKeys.findings(status),
    queryFn: async () => {
      const res = await apiGet(`/api/fleetgraph/findings?status=${status}`);
      return res.json();
    },
    refetchInterval: 30000, // Refresh every 30s
  });
}

export function useFleetGraphStatus() {
  return useQuery<FleetGraphStatus>({
    queryKey: fleetgraphKeys.status(),
    queryFn: async () => {
      const res = await apiGet('/api/fleetgraph/status');
      return res.json();
    },
    refetchInterval: 60000,
  });
}

export function useFleetGraphChat() {
  return useMutation({
    mutationFn: async (params: { message: string; documentId?: string; documentType?: string }) => {
      const res = await apiPost('/api/fleetgraph/chat', params);
      if (!res.ok) throw new Error('Chat request failed');
      return res.json();
    },
  });
}

export function useApproveFinding() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (findingId: string) => {
      const res = await apiPost(`/api/fleetgraph/findings/${findingId}/approve`);
      if (!res.ok) throw new Error('Approve failed');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: fleetgraphKeys.all });
    },
  });
}

export function useDismissFinding() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (findingId: string) => {
      const res = await apiPost(`/api/fleetgraph/findings/${findingId}/dismiss`);
      if (!res.ok) throw new Error('Dismiss failed');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: fleetgraphKeys.all });
    },
  });
}
