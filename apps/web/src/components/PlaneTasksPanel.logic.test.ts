import { describe, expect, it } from "vite-plus/test";
import type { PlaneSnapshot } from "@t3tools/contracts";
import { filterPlaneIssues } from "./PlaneTasksPanel.logic";

const data: PlaneSnapshot = {
  me: "owner",
  currentCycleId: "current",
  cycles: [],
  comments: [],
  states: [
    { id: "todo", name: "Открыто", group: "started" },
    { id: "done", name: "Готово", group: "completed" },
    { id: "cancelled", name: "Отменено", group: "cancelled" },
  ],
  issues: [
    {
      id: "1",
      key: "DINO-9",
      name: "Проверить узел",
      stateId: "todo",
      assignees: ["owner"],
      cycleId: "current",
    },
    {
      id: "2",
      key: "DINO-10",
      name: "Обновить панель",
      stateId: "done",
      assignees: ["owner"],
      cycleId: "current",
    },
    {
      id: "3",
      key: "DINO-11",
      name: "Проверить сеть",
      stateId: "todo",
      assignees: ["other"],
      cycleId: "old",
    },
    {
      id: "4",
      key: "DINO-12",
      name: "Старая задача",
      stateId: "cancelled",
      assignees: ["owner"],
      cycleId: null,
    },
  ].map((row) => ({ ...row, descriptionHtml: "", priority: "none", url: "https://plane.example" })),
};
const filters = { mine: true, cycle: "current", status: "open", search: "" };

describe("Plane task filters", () => {
  it("combines owner, cycle, status and case-insensitive title/key search", () => {
    expect(filterPlaneIssues(data, filters).map((row) => row.key)).toEqual(["DINO-9"]);
    expect(
      filterPlaneIssues(data, { ...filters, mine: false, cycle: "all", search: " ПРОВЕРИТЬ " }).map(
        (row) => row.key,
      ),
    ).toEqual(["DINO-11", "DINO-9"]);
    expect(
      filterPlaneIssues(data, { ...filters, status: "done", search: "dino-10" }).map(
        (row) => row.key,
      ),
    ).toEqual(["DINO-10"]);
    expect(filterPlaneIssues(data, { ...filters, cycle: "all", status: "all" })).toHaveLength(3);
  });
  it("shows an empty current cycle when none exists and supports tasks without a cycle", () => {
    expect(filterPlaneIssues({ ...data, currentCycleId: null }, filters)).toEqual([]);
    expect(filterPlaneIssues(data, { ...filters, cycle: "all", status: "cancelled" })[0]?.key).toBe(
      "DINO-12",
    );
    expect(filterPlaneIssues(data, { ...filters, search: "absent" })).toEqual([]);
  });
});
