import { PlaneReadError, type PlaneReadInput, type PlaneSnapshot } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientResponse } from "effect/http";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";

const PLANE_PROJECT = "ae35a379-e646-4966-ac33-3267d33fee56";
const Id = Schema.Union([Schema.String, Schema.Struct({ id: Schema.String })]);
const idOf = (value: typeof Id.Type) => (typeof value === "string" ? value : value.id);
const RawIssue = Schema.Struct({
  id: Schema.String,
  sequence_id: Schema.Number,
  name: Schema.String,
  state: Id,
  priority: Schema.String,
  assignees: Schema.Array(Id),
  cycle_id: Schema.optional(Schema.NullOr(Schema.String)),
  description_html: Schema.optional(Schema.NullOr(Schema.String)),
});
const RawState = Schema.Struct({ id: Schema.String, name: Schema.String, group: Schema.String });
const RawCycle = Schema.Struct({ id: Schema.String, name: Schema.String });
const RawComment = Schema.Struct({
  id: Schema.String,
  comment_html: Schema.String,
  created_at: Schema.String,
});
const Configuration = Schema.Struct({
  mcpServers: Schema.Struct({
    plane: Schema.Struct({
      env: Schema.Struct({
        PLANE_API_KEY: Schema.NonEmptyString,
        PLANE_BASE_URL: Schema.NonEmptyString,
        PLANE_WORKSPACE_SLUG: Schema.NonEmptyString,
      }),
    }),
  }),
});

export class PlaneTasks extends Context.Service<
  PlaneTasks,
  {
    readonly available: (input: PlaneReadInput) => Effect.Effect<boolean>;
    readonly read: (input: PlaneReadInput) => Effect.Effect<PlaneSnapshot, PlaneReadError>;
  }
>()("t3/project/PlaneTasks") {}

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const home = yield* HostProcess.HomeDirectory;
  const projects = yield* ProjectStore.ProjectStoreV2;
  const http = (yield* HttpClient.HttpClient).pipe(HttpClient.withScope);
  const dinoRoot = path.join(home, "Проекты", "dino");
  const inside = (root: string, target: string) => {
    const relative = path.relative(root.normalize("NFC"), target.normalize("NFC"));
    return (
      relative === "" ||
      (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`))
    );
  };
  const realPath = (value: string) => fs.realPath(value).pipe(Effect.orElseSucceed(() => value));
  const readOptional = (value: string) =>
    fs.readFileString(value).pipe(Effect.orElseSucceed(() => ""));

  const available = Effect.fn("PlaneTasks.available")(function* (input: PlaneReadInput) {
    const project = yield* projects
      .get(input.projectId)
      .pipe(Effect.orElseSucceed(() => Option.none()));
    if (Option.isNone(project)) return false;
    const root = yield* realPath(dinoRoot);
    let folder = yield* realPath(project.value.workspaceRoot);
    if (inside(root, folder)) return true;
    while (true) {
      const gitFile = yield* readOptional(path.join(folder, ".git"));
      if (gitFile.startsWith("gitdir:")) {
        const gitDir = path.resolve(folder, gitFile.slice(7).trim());
        const common = (yield* readOptional(path.join(gitDir, "commondir"))).trim();
        const commonDir = yield* realPath(common ? path.resolve(gitDir, common) : gitDir);
        return inside(root, commonDir);
      }
      const parent = path.dirname(folder);
      if (parent === folder) return false;
      folder = parent;
    }
  });

  const read = Effect.fn("PlaneTasks.read")(function* (input: PlaneReadInput) {
    if (!(yield* available(input))) return yield* new PlaneReadError({ stage: "project" });
    const config = yield* fs.readFileString(path.join(dinoRoot, "ansible", ".mcp.json")).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(Configuration))),
      Effect.map((value) => value.mcpServers.plane.env),
      Effect.mapError(() => new PlaneReadError({ stage: "configuration" })),
    );
    const base = yield* Effect.try({
      try: () => {
        const url = new URL(config.PLANE_BASE_URL);
        if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash)
          throw new Error();
        return url.href.replace(/\/$/, "");
      },
      catch: () => new PlaneReadError({ stage: "configuration" }),
    });
    const workspace = encodeURIComponent(config.PLANE_WORKSPACE_SLUG);
    const root = `/workspaces/${workspace}/projects/${PLANE_PROJECT}`;
    const get = Effect.fn("PlaneTasks.get")(function* <A, I>(
      suffix: string,
      schema: Schema.Codec<A, I>,
    ) {
      return yield* http
        .get(`${base}/api/v1${suffix}`, { headers: { "X-API-Key": config.PLANE_API_KEY } })
        .pipe(
          Effect.flatMap(HttpClientResponse.filterStatusOk),
          Effect.flatMap((response) => response.json),
          Effect.timeout("20 seconds"),
          Effect.mapError(() => new PlaneReadError({ stage: "request" })),
          Effect.flatMap((value) =>
            Schema.decodeUnknownEffect(schema)(value).pipe(
              Effect.mapError(() => new PlaneReadError({ stage: "response" })),
            ),
          ),
          Effect.scoped,
        );
    });
    const all = Effect.fn("PlaneTasks.all")(function* <A, I>(
      suffix: string,
      schema: Schema.Codec<A, I>,
    ) {
      const pageSchema = Schema.Union([
        Schema.Array(schema),
        Schema.Struct({
          results: Schema.Array(schema),
          next_page_results: Schema.optional(Schema.Boolean),
          next_cursor: Schema.optional(Schema.NullOr(Schema.String)),
        }),
      ]);
      const result: A[] = [];
      const cursors = new Set<string>();
      let cursor: string | null = null;
      for (let page = 0; page < 50; page++) {
        const separator = suffix.includes("?") ? "&" : "?";
        const response: typeof pageSchema.Type = yield* get(
          `${suffix}${separator}per_page=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
          pageSchema,
        );
        if (!("results" in response)) return [...result, ...response];
        result.push(...response.results);
        if (!response.next_page_results) return result;
        if (!response.next_cursor || cursors.has(response.next_cursor)) break;
        cursor = response.next_cursor;
        cursors.add(response.next_cursor);
      }
      return yield* new PlaneReadError({ stage: "pagination" });
    });

    const [me, states, cycles, current, issues, comments] = yield* Effect.all(
      [
        get("/users/me/", Schema.Struct({ id: Schema.String })),
        all(`${root}/states/`, RawState),
        all(`${root}/cycles/`, RawCycle),
        all(`${root}/cycles/?cycle_view=current`, RawCycle),
        input.issueId
          ? get(`${root}/issues/${encodeURIComponent(input.issueId)}/`, RawIssue).pipe(
              Effect.map((issue) => [issue]),
            )
          : all(`${root}/issues/`, RawIssue),
        input.issueId
          ? all(`${root}/issues/${encodeURIComponent(input.issueId)}/comments/`, RawComment)
          : Effect.succeed([]),
      ],
      { concurrency: 4 },
    );
    return {
      me: me.id,
      states,
      cycles,
      currentCycleId: current[0]?.id ?? null,
      issues: issues.map((issue) => ({
        id: issue.id,
        key: `DINO-${issue.sequence_id}`,
        name: issue.name,
        stateId: idOf(issue.state),
        priority: issue.priority,
        assignees: issue.assignees.map(idOf),
        cycleId: issue.cycle_id ?? null,
        descriptionHtml: input.issueId ? (issue.description_html ?? "") : "",
        url: `${base}/${workspace}/projects/${PLANE_PROJECT}/issues/${encodeURIComponent(issue.id)}`,
      })),
      comments: comments.map((comment) => ({
        id: comment.id,
        html: comment.comment_html,
        createdAt: comment.created_at,
      })),
    };
  });
  return PlaneTasks.of({ available, read });
});

export const layer = Layer.effect(PlaneTasks, make);
