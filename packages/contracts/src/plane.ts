import * as Schema from "effect/Schema";
import { ProjectId, TrimmedNonEmptyString } from "./baseSchemas.ts";

export const PlaneReadInput = Schema.Struct({
  projectId: ProjectId,
  issueId: Schema.optional(TrimmedNonEmptyString),
});
export type PlaneReadInput = typeof PlaneReadInput.Type;

export const PlaneIssue = Schema.Struct({
  id: Schema.String,
  key: Schema.String,
  name: Schema.String,
  stateId: Schema.String,
  priority: Schema.String,
  assignees: Schema.Array(Schema.String),
  cycleId: Schema.NullOr(Schema.String),
  descriptionHtml: Schema.String,
  url: Schema.String,
});
export type PlaneIssue = typeof PlaneIssue.Type;

export const PlaneSnapshot = Schema.Struct({
  me: Schema.String,
  currentCycleId: Schema.NullOr(Schema.String),
  cycles: Schema.Array(Schema.Struct({ id: Schema.String, name: Schema.String })),
  states: Schema.Array(
    Schema.Struct({ id: Schema.String, name: Schema.String, group: Schema.String }),
  ),
  issues: Schema.Array(PlaneIssue),
  comments: Schema.Array(
    Schema.Struct({ id: Schema.String, html: Schema.String, createdAt: Schema.String }),
  ),
});
export type PlaneSnapshot = typeof PlaneSnapshot.Type;

export class PlaneReadError extends Schema.TaggedError<PlaneReadError>()("PlaneReadError", {
  stage: Schema.Literals(["project", "configuration", "request", "response", "pagination"]),
}) {
  override get message(): string {
    switch (this.stage) {
      case "project":
        return "Plane доступен только для проектов DINO.";
      case "configuration":
        return "Проверь локальную MCP-конфигурацию Plane в ~/Проекты/dino/ansible/.mcp.json.";
      case "request":
        return "Plane недоступен или отклонил запрос. Проверь подключение и локальный ключ.";
      case "response":
        return "Plane вернул ответ неизвестного формата.";
      case "pagination":
        return "Plane вернул слишком много страниц. Список не загружен полностью.";
    }
  }
}
