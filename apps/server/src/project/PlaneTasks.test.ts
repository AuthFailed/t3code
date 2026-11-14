import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { IsoDateTime, ProjectId } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import { HttpClient, HttpClientResponse } from "effect/http";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as PlaneTasks from "./PlaneTasks.ts";

const projectId = ProjectId.make("project");
const issue = {
  id: "issue",
  sequence_id: 42,
  name: "Проверить узел",
  state: "todo",
  priority: "high",
  assignees: ["owner"],
  cycle_id: "cycle",
  description_html: "<p>Описание</p>",
};

const fixture = (respond?: (url: URL) => Response | undefined) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const home = yield* fs.makeTempDirectoryScoped();
    const root = path.join(home, "Проекты", "dino");
    const repo = path.join(root, "ansible");
    yield* fs.makeDirectory(repo, { recursive: true });
    yield* fs.writeFileString(
      path.join(repo, ".mcp.json"),
      JSON.stringify({
        mcpServers: {
          plane: {
            env: {
              PLANE_API_KEY: "test-key",
              PLANE_BASE_URL: "https://plane.example",
              PLANE_WORKSPACE_SLUG: "workspace",
            },
          },
        },
      }),
    );
    const workspaces = new Map([[projectId, repo]]);
    const urls: string[] = [];
    const keys: Array<string | undefined> = [];
    const http = HttpClient.make((request) =>
      Effect.sync(() => {
        urls.push(request.url);
        keys.push(request.headers["x-api-key"]);
        const url = new URL(request.url);
        const body =
          url.pathname === "/api/v1/users/me/"
            ? { id: "owner" }
            : url.pathname.endsWith("/states/")
              ? [{ id: "todo", name: "В работе", group: "started" }]
              : url.pathname.endsWith("/cycles/")
                ? [{ id: "cycle", name: "Неделя" }]
                : url.pathname.endsWith("/comments/")
                  ? [
                      {
                        id: "comment",
                        comment_html: "<p>Комментарий</p>",
                        created_at: "2026-01-01T00:00:00Z",
                      },
                    ]
                  : url.pathname.endsWith("/issues/issue/")
                    ? { ...issue, state: { id: "todo" }, assignees: [{ id: "owner" }] }
                    : { results: [issue], next_page_results: false };
        return HttpClientResponse.fromWeb(request, respond?.(url) ?? Response.json(body));
      }),
    );
    const service = yield* PlaneTasks.PlaneTasks.pipe(
      Effect.provide(
        PlaneTasks.layer.pipe(
          Layer.provide(
            Layer.mock(ProjectStore.ProjectStoreV2)({
              get: (id) =>
                Effect.succeed(
                  Option.fromNullishOr(workspaces.get(id)).pipe(
                    Option.map((workspaceRoot) => ({
                      projectId: id,
                      workspaceRoot,
                      title: "Project",
                      hasCustomTitle: false,
                      defaultModelSelection: null,
                      defaultThreadEnvMode: null,
                      autoPull: false,
                      faviconPath: null,
                      projectIcon: null,
                      scripts: [],
                      pinnedAt: null,
                      archivedAt: null,
                      createdAt: IsoDateTime.make("2026-01-01T00:00:00Z"),
                      updatedAt: IsoDateTime.make("2026-01-01T00:00:00Z"),
                      deletedAt: null,
                    })),
                  ),
                ),
            }),
          ),
        ),
      ),
      Effect.provideService(HostProcess.HomeDirectory, home),
      Effect.provideService(HttpClient.HttpClient, http),
    );
    return { service, workspaces, home, repo, fs, path, urls, keys };
  });

it.layer(NodeServices.layer)("PlaneTasks", (it) => {
  it.effect("recognizes DINO, symlinks and linked worktrees without contacting Plane", () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      expect(yield* f.service.available({ projectId })).toBe(true);
      const worktree = f.path.join(f.home, "worktrees", "branch");
      const gitDir = f.path.join(f.repo, ".git", "worktrees", "branch");
      yield* f.fs.makeDirectory(worktree, { recursive: true });
      yield* f.fs.makeDirectory(gitDir, { recursive: true });
      yield* f.fs.writeFileString(f.path.join(worktree, ".git"), `gitdir: ${gitDir}\n`);
      yield* f.fs.writeFileString(f.path.join(gitDir, "commondir"), "../..\n");
      f.workspaces.set(projectId, worktree);
      expect(yield* f.service.available({ projectId })).toBe(true);
      const link = f.path.join(f.home, "dino-link");
      yield* f.fs.symlink(f.repo, link);
      f.workspaces.set(projectId, link);
      expect(yield* f.service.available({ projectId })).toBe(true);
      expect(f.urls).toEqual([]);
    }),
  );

  it.effect(
    "refuses unrelated, missing and similarly named projects before reading credentials",
    () =>
      Effect.gen(function* () {
        const f = yield* fixture();
        f.workspaces.set(projectId, f.path.join(f.home, "Проекты", "dino-other"));
        expect(yield* f.service.available({ projectId })).toBe(false);
        expect((yield* f.service.read({ projectId }).pipe(Effect.flip)).stage).toBe("project");
        expect(yield* f.service.available({ projectId: ProjectId.make("missing") })).toBe(false);
        expect(f.urls).toEqual([]);
      }),
  );

  it.effect("reads all cursor pages and normalizes detail ids without returning credentials", () =>
    Effect.gen(function* () {
      const f = yield* fixture((url) =>
        url.pathname.endsWith("/issues/")
          ? Response.json({
              results: [{ ...issue, id: url.searchParams.has("cursor") ? "second" : "first" }],
              next_page_results: !url.searchParams.has("cursor"),
              next_cursor: "next/page",
            })
          : undefined,
      );
      const list = yield* f.service.read({ projectId });
      expect(list.issues.map((row) => row.id)).toEqual(["first", "second"]);
      expect(list.issues[0]?.descriptionHtml).toBe("");
      const detail = yield* f.service.read({ projectId, issueId: "issue" });
      expect(detail.issues[0]).toMatchObject({
        key: "DINO-42",
        stateId: "todo",
        assignees: ["owner"],
        descriptionHtml: "<p>Описание</p>",
      });
      expect(detail.comments).toHaveLength(1);
      expect(f.keys.every((key) => key === "test-key")).toBe(true);
      expect(JSON.stringify(detail)).not.toContain("test-key");
    }),
  );

  it.effect("rejects repeated cursors instead of returning a partial task list", () =>
    Effect.gen(function* () {
      const f = yield* fixture((url) =>
        url.pathname.endsWith("/issues/")
          ? Response.json({ results: [issue], next_page_results: true, next_cursor: "repeated" })
          : undefined,
      );
      expect((yield* f.service.read({ projectId }).pipe(Effect.flip)).stage).toBe("pagination");
    }),
  );

  it.effect("reports invalid configuration, denied requests and malformed responses safely", () =>
    Effect.gen(function* () {
      for (const [status, body, stage] of [
        [403, "test-key", "request"],
        [200, "{}", "response"],
      ] as const) {
        const f = yield* fixture(() => new Response(body, { status }));
        const error = yield* f.service.read({ projectId }).pipe(Effect.flip);
        expect(error.stage).toBe(stage);
        expect(JSON.stringify(error)).not.toContain("test-key");
      }
      const f = yield* fixture();
      yield* f.fs.writeFileString(f.path.join(f.repo, ".mcp.json"), "{}");
      expect((yield* f.service.read({ projectId }).pipe(Effect.flip)).stage).toBe("configuration");
      expect(f.urls).toEqual([]);
    }),
  );
});
