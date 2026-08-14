import { describe, expect, it, vi } from "vitest";
import type { Project } from "../types.js";
import { discoverGitWorktrees, isGitRepository } from "./gitWorktreeDiscovery.js";
import { WorkspaceService } from "./workspaceService.js";

vi.mock("./gitWorktreeDiscovery.js", () => ({
  discoverGitWorktrees: vi.fn(),
  isGitRepository: vi.fn(),
}));

const project = (path: string): Project => ({
  id: "project-1",
  name: "nested-app",
  path,
  createdAt: "2026-08-14T00:00:00.000Z",
});

describe("WorkspaceService", () => {
  it("keeps an exact Git worktree root and its linked worktrees", async () => {
    vi.mocked(isGitRepository).mockResolvedValue(true);
    vi.mocked(discoverGitWorktrees).mockResolvedValue([
      { path: "/repo", branch: "main" },
      { path: "/feature", branch: "feature" },
    ]);

    await expect(new WorkspaceService().list(project("/repo"))).resolves.toEqual([
      expect.objectContaining({ path: "/repo", label: "main", isMain: true, isGitWorktree: true }),
      expect.objectContaining({ path: "/feature", label: "feature", isMain: false, isGitWorktree: true }),
    ]);
  });

  it("uses a registered Git subdirectory as one exact workspace", async () => {
    vi.mocked(isGitRepository).mockResolvedValue(true);
    vi.mocked(discoverGitWorktrees).mockResolvedValue([
      { path: "/repo", branch: "main" },
      { path: "/feature", branch: "feature" },
    ]);

    const workspaces = await new WorkspaceService().list(project("/repo/packages/nested-app"));

    expect(workspaces).toHaveLength(1);
    expect(workspaces[0]).toMatchObject({
      projectId: "project-1",
      path: "/repo/packages/nested-app",
      label: "nested-app",
      isMain: true,
      isGitRepo: true,
      isGitWorktree: false,
    });
    expect(workspaces[0]?.id).toHaveLength(12);
  });
});
