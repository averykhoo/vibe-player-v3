export type NotificationType = "info" | "error" | "success" | "warning";

export interface StatusState {
  message: string | null;
  type: NotificationType | null;
  isLoading: boolean; // General loading indicator for the app
  details?: string | null; // Optional field for more detailed messages or error info
  progress?: number | null; // For operations that have a progress, e.g. file loading
}
