import type { PlaneSnapshot } from "@t3tools/contracts";

export function filterPlaneIssues(
  data: PlaneSnapshot,
  filters: { mine: boolean; cycle: string; status: string; search: string },
) {
  const query = filters.search.trim().toLocaleLowerCase("ru");
  const cycleId = filters.cycle === "current" ? data.currentCycleId : filters.cycle;
  const closed = new Set(
    data.states
      .filter((state) => state.group === "completed" || state.group === "cancelled")
      .map((state) => state.id),
  );
  return data.issues
    .filter(
      (issue) =>
        (!filters.mine || issue.assignees.includes(data.me)) &&
        (filters.cycle === "all" || (cycleId !== null && issue.cycleId === cycleId)) &&
        (filters.status === "all" ||
          (filters.status === "open"
            ? !closed.has(issue.stateId)
            : issue.stateId === filters.status)) &&
        (!query || `${issue.key} ${issue.name}`.toLocaleLowerCase("ru").includes(query)),
    )
    .sort((a, b) => Number(b.key.slice(5)) - Number(a.key.slice(5)));
}
