import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';

export interface ActionItem {
  id: string;
  title: string;
  state: string;
  priority: string;
  ticket_number: number;
  display_id: string;
  due_date: string | null;
  is_system_generated: boolean;
  accountability_type: string | null;
  accountability_target_id: string | null;
  target_title?: string;
  days_overdue: number;
  // Additional metadata for weekly_plan/weekly_retro navigation
  person_id?: string | null;
  project_id?: string | null;
  week_number?: number | null;
}

interface ActionItemsResponse {
  items: ActionItem[];
  total: number;
  has_overdue: boolean;
  has_due_today: boolean;
}

export const actionItemsKeys = {
  all: ['action-items'] as const,
  list: () => [...actionItemsKeys.all, 'list'] as const,
};

export function useActionItemsQuery() {
  return useQuery<ActionItemsResponse>({
    queryKey: actionItemsKeys.list(),
    queryFn: async () => {
      // Use inference-based endpoint - computes items dynamically from project/sprint state
      const response = await apiGet('/api/accountability/action-items');
      if (!response.ok) {
        throw new Error('Failed to fetch action items');
      }
      const data: ActionItemsResponse = await response.json();
      return data;
    },
    // Refetch frequently since these are important accountability items
    staleTime: 30 * 1000, // 30 seconds
    refetchInterval: 60 * 1000, // Refetch every minute
  });
}
