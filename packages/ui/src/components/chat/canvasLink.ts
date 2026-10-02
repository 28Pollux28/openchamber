import { fetchCanvas } from '@/lib/canvasApi';
import { createProjectIdFromPath } from '@/lib/projectId';
import { useDirectoryStore } from '@/stores/useDirectoryStore';
import { useProjectsStore } from '@/stores/useProjectsStore';
import { useSessionUIStore } from '@/sync/session-ui-store';
import { useUIStore } from '@/stores/useUIStore';
import { resolveProjectContextOwner } from '@/hooks/useProjectContextOwner';

/**
 * Opens a `canvas:<id>` link clicked in chat.
 *
 * The link carries only the id, so the owner (project) and the title come
 * from the same resolution the Canvas panel uses: the current directory
 * resolved to its project, then one small metadata read. A failed read
 * still opens the tab — the viewer has its own error state — and a missing
 * canvas shows its gone state, which is the truth.
 */
export const openCanvasLink = (canvasId: string): void => {
  void (async () => {
    const directoryStore = useDirectoryStore.getState();
    const projectsStore = useProjectsStore.getState();
    const sessionUIStore = useSessionUIStore.getState();
    const directory = directoryStore.currentDirectory;
    const owner = resolveProjectContextOwner({
      projects: projectsStore.projects,
      worktreesByProject: sessionUIStore.availableWorktreesByProject,
      directory,
      activeProjectId: projectsStore.activeProjectId,
      chatDraftOpen: sessionUIStore.newSessionDraft.open,
      chatDraftTarget: sessionUIStore.newSessionDraft.target,
      homeDirectory: directoryStore.homeDirectory,
    });
    if (!owner || !directory) return;

    const projectId = createProjectIdFromPath(owner.path);
    const detail = await fetchCanvas(projectId, canvasId).catch(() => null);
    useUIStore.getState().openCanvasTab(directory, { id: canvasId, title: detail?.title ?? '' });
  })();
};
