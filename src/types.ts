export interface Task {
  id: string;
  title: string;
  description?: string;
  status: 'pending' | 'completed';
  createdAt: number;
  updatedAt: number;
  userId: string;
  clientTaskId?: string;
}
