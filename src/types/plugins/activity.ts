/**
 * Activity Plugin Types
 * Sources: plugins/activity/frontend/types/index.ts
 */

export interface ActivityLog {
    id: string;
    timestamp: string;
    description: string;
    short_description?: string | null;
}

export interface ActivityTimelineResponse {
    logs: ActivityLog[];
    summary?: string | null;
}
