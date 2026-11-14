import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import { scopeProjectRef, scopedProjectKey } from "@t3tools/client-runtime/environment";
import type { PlaneIssue, PlaneSnapshot, ScopedProjectRef } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import { ArrowLeftIcon, ArrowUpRightIcon, ListTodoIcon, RefreshCwIcon } from "lucide-react";
import { useState } from "react";
import { useHandleNewThread, useNewThreadHandler } from "../hooks/useHandleNewThread";
import { planeAvailable, planeTasks } from "../state/projects";
import ChatMarkdown from "./ChatMarkdown";
import { Button } from "./ui/button";
import { Dialog, DialogDescription, DialogHeader, DialogPopup, DialogTitle } from "./ui/dialog";
import { Input } from "./ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "./ui/select";
import { filterPlaneIssues } from "./PlaneTasksPanel.logic";

const PRIORITY_LABELS: Record<string, string> = {
  urgent: "Срочно",
  high: "Высокий приоритет",
  medium: "Средний приоритет",
  low: "Низкий приоритет",
  none: "Без приоритета",
};

export function PlaneTasksButton({
  projectRef: selectedProjectRef,
}: {
  projectRef?: ScopedProjectRef | undefined;
}) {
  const context = useHandleNewThread();
  const active = context.activeDraftThread ?? context.activeThread;
  const projectRef =
    selectedProjectRef ??
    (active ? scopeProjectRef(active.environmentId, active.projectId) : context.defaultProjectRef);
  return projectRef ? (
    <ProjectPlaneTasks key={scopedProjectKey(projectRef)} projectRef={projectRef} />
  ) : null;
}

function ProjectPlaneTasks({ projectRef }: { projectRef: ScopedProjectRef }) {
  const available = useAtomValue(
    planeAvailable({
      environmentId: projectRef.environmentId,
      input: { projectId: projectRef.projectId },
    }),
  );
  const [open, setOpen] = useState(false);
  if (!AsyncResult.isSuccess(available) || !available.value) return null;
  return (
    <>
      <div className="pt-2">
        <Button variant="ghost-muted" size="sm" onClick={() => setOpen(true)}>
          <ListTodoIcon /> Задачи DINO <span className="text-xs text-muted-foreground">Plane</span>
        </Button>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogPopup aria-label="Задачи DINO" className="h-[min(46rem,90dvh)] max-w-5xl">
          <DialogHeader>
            <DialogTitle>Задачи DINO</DialogTitle>
            <DialogDescription>Plane · задачи рядом с кодом</DialogDescription>
          </DialogHeader>
          {open ? (
            <PlaneTaskBrowser projectRef={projectRef} onClose={() => setOpen(false)} />
          ) : null}
        </DialogPopup>
      </Dialog>
    </>
  );
}

function QueryFailure({ message, retry }: { message: string; retry: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-start gap-3 p-5 text-sm">
      <p>{message}</p>
      <Button variant="outline" size="sm" onClick={retry}>
        Повторить
      </Button>
    </div>
  );
}

function PlaneTaskBrowser({
  projectRef,
  onClose,
}: {
  projectRef: ScopedProjectRef;
  onClose: () => void;
}) {
  const query = planeTasks({
    environmentId: projectRef.environmentId,
    input: { projectId: projectRef.projectId },
  });
  const result = useAtomValue(query);
  const refresh = useAtomRefresh(query);
  if (AsyncResult.isFailure(result)) {
    const error = Cause.squash(result.cause);
    return (
      <QueryFailure
        message={error instanceof Error ? error.message : "Не удалось загрузить задачи Plane."}
        retry={refresh}
      />
    );
  }
  if (!AsyncResult.isSuccess(result))
    return (
      <p role="status" className="p-5 text-sm text-muted-foreground">
        Загружаю задачи…
      </p>
    );
  return (
    <PlaneTaskList
      projectRef={projectRef}
      data={result.value}
      refreshing={result.waiting}
      refresh={refresh}
      onClose={onClose}
    />
  );
}

function PlaneTaskList({
  projectRef,
  data,
  refresh,
  refreshing,
  onClose,
}: {
  projectRef: ScopedProjectRef;
  data: PlaneSnapshot;
  refresh: () => void;
  refreshing: boolean;
  onClose: () => void;
}) {
  const [mine, setMine] = useState(true);
  const [cycle, setCycle] = useState("current");
  const [status, setStatus] = useState("open");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<PlaneIssue | null>(null);
  const rows = filterPlaneIssues(data, { mine, cycle, status, search });
  return (
    <div className="flex min-h-0 flex-1 border-t">
      <section
        aria-label="Список задач"
        className={`min-h-0 w-full flex-col border-r md:flex md:w-80 md:shrink-0 ${selected ? "hidden" : "flex"}`}
      >
        <div className="flex flex-col gap-3 border-b p-3">
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant={mine ? "secondary" : "ghost-muted"}
              aria-pressed={mine}
              onClick={() => setMine(true)}
            >
              Мои
            </Button>
            <Button
              size="sm"
              variant={!mine ? "secondary" : "ghost-muted"}
              aria-pressed={!mine}
              onClick={() => setMine(false)}
            >
              Все
            </Button>
            <span className="ml-auto text-xs tabular-nums text-muted-foreground">
              {rows.length}
            </span>
            <Button
              size="icon-sm"
              variant="ghost-muted"
              aria-label="Обновить задачи"
              disabled={refreshing}
              onClick={refresh}
            >
              <RefreshCwIcon />
            </Button>
          </div>
          <Input
            type="search"
            aria-label="Поиск задач"
            placeholder="Найти задачу или DINO-…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <Select value={cycle} onValueChange={(value) => value !== null && setCycle(value)}>
            <SelectTrigger size="sm" aria-label="Цикл задач">
              <SelectValue>
                {cycle === "current"
                  ? "Текущий цикл"
                  : cycle === "all"
                    ? "Все циклы"
                    : data.cycles.find((item) => item.id === cycle)?.name}
              </SelectValue>
            </SelectTrigger>
            <SelectPopup>
              <SelectItem value="current">Текущий цикл</SelectItem>
              <SelectItem value="all">Все циклы</SelectItem>
              {data.cycles.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.name}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
          <Select value={status} onValueChange={(value) => value !== null && setStatus(value)}>
            <SelectTrigger size="sm" aria-label="Статус задач">
              <SelectValue>
                {status === "open"
                  ? "Открытые"
                  : status === "all"
                    ? "Все статусы"
                    : data.states.find((item) => item.id === status)?.name}
              </SelectValue>
            </SelectTrigger>
            <SelectPopup>
              <SelectItem value="open">Открытые</SelectItem>
              <SelectItem value="all">Все статусы</SelectItem>
              {data.states.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.name}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {rows.length === 0 ? (
            <p className="p-3 text-sm text-muted-foreground">
              {cycle === "current" && !data.currentCycleId
                ? "Нет текущего цикла. Выбери «Все циклы»."
                : "Под эти фильтры задач нет."}
            </p>
          ) : null}
          {rows.map((issue) => (
            <button
              key={issue.id}
              type="button"
              aria-pressed={selected?.id === issue.id}
              onClick={() => setSelected(issue)}
              className="flex w-full flex-col gap-1 rounded-lg px-3 py-3 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring aria-pressed:bg-accent"
            >
              <span className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                <span className="font-mono">{issue.key}</span>
                <span>{data.states.find((state) => state.id === issue.stateId)?.name}</span>
              </span>
              <span className="text-sm leading-relaxed">{issue.name}</span>
            </button>
          ))}
        </div>
      </section>
      <section
        aria-label="Карточка задачи"
        className={`min-h-0 min-w-0 flex-1 flex-col md:flex ${selected ? "flex" : "hidden"}`}
      >
        {selected ? (
          <PlaneTaskDetail
            key={selected.id}
            projectRef={projectRef}
            issueId={selected.id}
            onBack={() => setSelected(null)}
            onClose={onClose}
          />
        ) : (
          <div className="m-auto flex flex-col items-center gap-3 p-8 text-center text-sm text-muted-foreground">
            <ListTodoIcon className="size-8" />
            <p>Выбери задачу, чтобы открыть описание и комментарии.</p>
          </div>
        )}
      </section>
    </div>
  );
}

function PlaneTaskDetail({
  projectRef,
  issueId,
  onBack,
  onClose,
}: {
  projectRef: ScopedProjectRef;
  issueId: string;
  onBack: () => void;
  onClose: () => void;
}) {
  const query = planeTasks({
    environmentId: projectRef.environmentId,
    input: { projectId: projectRef.projectId, issueId },
  });
  const result = useAtomValue(query);
  const refresh = useAtomRefresh(query);
  const newThread = useNewThreadHandler();
  const [opening, setOpening] = useState(false);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const data = AsyncResult.isSuccess(result) ? result.value : null;
  const issue = data?.issues[0];
  const start = async () => {
    if (!issue) return;
    setOpening(true);
    setLaunchError(null);
    try {
      const draft = await newThread(projectRef, {
        prompt: `${issue.key}: ${issue.name}\n${issue.url}`,
      });
      if (draft) onClose();
      else setLaunchError("Не удалось открыть тред. Проверь доступ к проекту.");
    } catch {
      setLaunchError("Не удалось открыть тред. Попробуй ещё раз.");
    }
    setOpening(false);
  };
  return (
    <>
      <div className="flex shrink-0 items-center gap-2 border-b p-3">
        <Button size="icon-sm" variant="ghost-muted" aria-label="Назад к списку" onClick={onBack}>
          <ArrowLeftIcon />
        </Button>
        <span className="font-mono text-xs text-muted-foreground">{issue?.key ?? "Задача"}</span>
        {issue ? (
          <div className="ml-auto flex items-center gap-1">
            <Button
              size="icon-sm"
              variant="ghost-muted"
              aria-label="Открыть в Plane"
              render={<a href={issue.url} target="_blank" rel="noreferrer" />}
            >
              <ArrowUpRightIcon />
            </Button>
            <Button size="sm" disabled={opening} onClick={() => void start()}>
              {opening ? "Открываю…" : "Открыть тред"}
            </Button>
          </div>
        ) : null}
      </div>
      {launchError ? (
        <p role="alert" className="px-5 pt-3 text-sm text-destructive">
          {launchError}
        </p>
      ) : null}
      {AsyncResult.isFailure(result) ? (
        <QueryFailure message="Не удалось загрузить карточку задачи." retry={refresh} />
      ) : !issue || !data ? (
        <p role="status" className="p-5 text-sm text-muted-foreground">
          Загружаю задачу…
        </p>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <p className="mb-2 text-xs text-muted-foreground">
            {data.states.find((state) => state.id === issue.stateId)?.name} ·{" "}
            {PRIORITY_LABELS[issue.priority] ?? issue.priority}
          </p>
          <h2 className="mb-5 text-xl font-semibold leading-snug">{issue.name}</h2>
          {issue.descriptionHtml ? (
            <ChatMarkdown
              text={issue.descriptionHtml}
              cwd={undefined}
              environmentId={projectRef.environmentId}
            />
          ) : (
            <p className="text-sm text-muted-foreground">Описания пока нет.</p>
          )}
          <h3 className="mb-3 mt-8 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Комментарии · {data.comments.length}
          </h3>
          {data.comments.map((comment) => (
            <article key={comment.id} className="border-t py-4">
              <time className="mb-2 block text-xs text-muted-foreground">
                {new Date(comment.createdAt).toLocaleString("ru")}
              </time>
              <ChatMarkdown
                text={comment.html}
                cwd={undefined}
                environmentId={projectRef.environmentId}
              />
            </article>
          ))}
        </div>
      )}
    </>
  );
}
