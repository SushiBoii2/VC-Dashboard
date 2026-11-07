import * as DataStore from "@api/DataStore";

const DATA_KEY = "discord-workspace-v1";

export interface WorkspaceData {
    notes: Array<{ id: string; title: string; body: string; updatedAt: number }>;
    links: Array<{ id: string; url: string; label: string; addedAt: number }>;
    tasks: Array<{ id: string; text: string; done: boolean; addedAt: number }>;
}

export const EMPTY_WORKSPACE: WorkspaceData = { notes: [], links: [], tasks: [] };

export async function loadWorkspace(): Promise<WorkspaceData> {
    const value = await DataStore.get<WorkspaceData>(DATA_KEY);
    return value ?? EMPTY_WORKSPACE;
}

export async function saveWorkspace(value: WorkspaceData): Promise<void> {
    await DataStore.set(DATA_KEY, value);
}
