import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { generateExam, type ExamQuestion } from "@/lib/exam.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Loader2,
  GraduationCap,
  CheckCircle2,
  XCircle,
  Sparkles,
  RefreshCw,
  Shuffle,
  Trophy,
  ChevronLeft,
  ChevronRight,
  Info,
  Settings2,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({
  component: ExamGeneratorPage,
  head: () => ({
    meta: [
      { title: "Exam Generator — Instant Multiple Choice Quizzes" },
      {
        name: "description",
        content:
          "Generate custom multiple-choice exams by topic and difficulty. Preview answers and explanations instantly.",
      },
    ],
  }),
});

type Difficulty = "Beginner" | "Intermediate" | "Advanced";

function shuffle<T>(arr: T[], seed: number): T[] {
  const a = [...arr];
  let s = seed || 1;
  const rand = () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const LS_KEY = "exam-gen-settings";

function loadSettings() {
  try {
    if (typeof window === "undefined") return null;
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const validDiff = (["Beginner", "Intermediate", "Advanced"] as Difficulty[]).includes(
      parsed.difficulty
    );
    return {
      topic: typeof parsed.topic === "string" ? parsed.topic : "",
      difficulty: validDiff ? (parsed.difficulty as Difficulty) : ("Intermediate" as Difficulty),
      numQuestions:
        typeof parsed.numQuestions === "number"
          ? Math.max(1, Math.min(30, parsed.numQuestions))
          : 5,
      autoGenerate: typeof parsed.autoGenerate === "boolean" ? parsed.autoGenerate : true,
      shuffleOptions: typeof parsed.shuffleOptions === "boolean" ? parsed.shuffleOptions : false,
    };
  } catch {
    return null;
  }
}

function ExamGeneratorPage() {
  const saved = loadSettings();
  const [topic, setTopic] = useState(saved?.topic ?? "");
  const [difficulty, setDifficulty] = useState<Difficulty>(saved?.difficulty ?? "Intermediate");
  const [numQuestions, setNumQuestions] = useState(saved?.numQuestions ?? 5);
  const [autoGenerate, setAutoGenerate] = useState(saved?.autoGenerate ?? true);
  const [shuffleOptions, setShuffleOptions] = useState(saved?.shuffleOptions ?? false);
  const [shuffleSeed, setShuffleSeed] = useState(1);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [revealed, setRevealed] = useState<Record<number, boolean>>({});
  const [reviewMode, setReviewMode] = useState(false);
  const [reviewIndex, setReviewIndex] = useState(0);
  const [takingIndex, setTakingIndex] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(true);

  useEffect(() => {
    try {
      localStorage.setItem(
        LS_KEY,
        JSON.stringify({ topic, difficulty, numQuestions, autoGenerate, shuffleOptions })
      );
    } catch {
      // ignore
    }
  }, [topic, difficulty, numQuestions, autoGenerate, shuffleOptions]);

  const generateFn = useServerFn(generateExam);
  const SEEN_LS_KEY = "exam-gen-seen-v1";
  const seenRef = useRef<Map<string, string[]>>(new Map());
  const seenKey = (t: string, d: Difficulty) => `${d}::${t.trim().toLowerCase()}`;

  useEffect(() => {
    try {
      const raw = localStorage.getItem(SEEN_LS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Record<string, string[]>;
      if (parsed && typeof parsed === "object") {
        seenRef.current = new Map(Object.entries(parsed));
      }
    } catch {
      // ignore
    }
  }, []);

  const persistSeen = useCallback(() => {
    try {
      const obj: Record<string, string[]> = {};
      seenRef.current.forEach((v, k) => {
        obj[k] = v;
      });
      localStorage.setItem(SEEN_LS_KEY, JSON.stringify(obj));
    } catch {
      // ignore
    }
  }, []);

  const mutation = useMutation({
    mutationFn: (vars: {
      topic: string;
      difficulty: Difficulty;
      numQuestions: number;
      nonce: string;
      avoid: string[];
    }) => generateFn({ data: vars }),
    onSuccess: (res, vars) => {
      setAnswers({});
      setRevealed({});
      setReviewMode(false);
      setReviewIndex(0);
      setTakingIndex(0);
      setShuffleSeed((s) => s + 1);
      const key = seenKey(vars.topic, vars.difficulty);
      const prev = seenRef.current.get(key) ?? [];
      const next = [...prev, ...res.questions.map((q) => q.question)].slice(-500);
      seenRef.current.set(key, next);
      persistSeen();
      if (typeof window !== "undefined" && window.matchMedia("(max-width: 1023px)").matches) {
        setSettingsOpen(false);
      }
    },
  });

  const run = useCallback(
    (overrideNum?: number) => {
      const t = topic.trim();
      if (!t) return;
      const n = overrideNum ?? numQuestions;
      if (!n || n < 1) return;
      const nonce = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      const avoid = seenRef.current.get(seenKey(t, difficulty)) ?? [];
      mutation.mutate({ topic: t, difficulty, numQuestions: n, nonce, avoid });
    },
    [topic, difficulty, numQuestions, mutation]
  );

  useEffect(() => {
    setAnswers({});
    setRevealed({});
    setReviewMode(false);
    setReviewIndex(0);
    setTakingIndex(0);
  }, [topic, difficulty, numQuestions]);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firstRunRef = useRef(true);
  useEffect(() => {
    if (!autoGenerate) return;
    if (!topic.trim()) return;
    if (!numQuestions || numQuestions < 1) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const delay = firstRunRef.current ? 900 : 600;
    debounceRef.current = setTimeout(() => {
      firstRunRef.current = false;
      run();
    }, delay);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topic, difficulty, numQuestions, autoGenerate]);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    run();
  };

  const rawQuestions: ExamQuestion[] = mutation.data?.questions ?? [];

  const displayedQuestions = useMemo(() => {
    if (!shuffleOptions) return rawQuestions;
    return rawQuestions.map((q) => ({
      ...q,
      options: shuffle(q.options, shuffleSeed + q.question_number * 7919),
    }));
  }, [rawQuestions, shuffleOptions, shuffleSeed]);

  useEffect(() => {
    setAnswers({});
    setRevealed({});
    setReviewMode(false);
    setReviewIndex(0);
    setTakingIndex(0);
  }, [shuffleOptions, shuffleSeed]);

  useEffect(() => {
    if (reviewMode || displayedQuestions.length === 0) return;
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      const total = displayedQuestions.length;
      const idx = Math.min(takingIndex, total - 1);
      const q = displayedQuestions[idx];
      if (!q) return;
      if (e.key === "ArrowRight" && idx < total - 1) {
        setTakingIndex(idx + 1);
      } else if (e.key === "ArrowLeft" && idx > 0) {
        setTakingIndex(idx - 1);
      } else if (["1", "2", "3", "4"].includes(e.key)) {
        const n = parseInt(e.key, 10) - 1;
        const opt = q.options[n];
        if (opt && !revealed[q.question_number]) {
          setAnswers((a) => ({ ...a, [q.question_number]: opt }));
          setRevealed((r) => ({ ...r, [q.question_number]: true }));
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [reviewMode, displayedQuestions, takingIndex, revealed]);

  const total = displayedQuestions.length;
  const answeredCount = displayedQuestions.filter(
    (q) => answers[q.question_number] !== undefined
  ).length;
  const correctCount = displayedQuestions.filter(
    (q) =>
      revealed[q.question_number] &&
      answers[q.question_number] === q.correct_answer
  ).length;
  const allRevealed = total > 0 && answeredCount === total;
  const pct = total > 0 ? Math.round((correctCount / total) * 100) : 0;
  const progressPct = total > 0 ? Math.round((answeredCount / total) * 100) : 0;
  const currentIndex = reviewMode ? reviewIndex : takingIndex;
  const positionPct = total > 0 ? Math.round(((currentIndex + 1) / total) * 100) : 0;

  return (
    <div className="min-h-dvh w-full overflow-x-hidden bg-background text-foreground safe-pt safe-pb">
      <div className="mx-auto grid w-full max-w-6xl grid-cols-1 gap-4 p-3 sm:gap-6 sm:p-6 lg:grid-cols-[minmax(300px,360px)_1fr] lg:gap-8 lg:p-8">
        <aside className="order-1 flex h-fit flex-col overflow-hidden rounded-2xl border border-border bg-secondary/60 sm:rounded-3xl lg:sticky lg:top-6 lg:order-none">
          <div className="flex items-center justify-between gap-3 p-4 sm:p-6 lg:p-7 lg:pb-0">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-lg shadow-primary/20 sm:h-11 sm:w-11">
                <GraduationCap className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <h1 className="truncate font-display text-base font-bold tracking-tight text-foreground sm:text-lg">
                  Exam Generator
                </h1>
                <p className="truncate text-xs text-muted-foreground">AI-powered MCQ drafting</p>
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="shrink-0 rounded-xl lg:hidden"
              onClick={() => setSettingsOpen((o) => !o)}
              aria-expanded={settingsOpen}
            >
              <Settings2 className="mr-1.5 h-4 w-4" />
              {settingsOpen ? (
                <>
                  Hide <ChevronUp className="ml-1 h-3.5 w-3.5" />
                </>
              ) : (
                <>
                  Settings <ChevronDown className="ml-1 h-3.5 w-3.5" />
                </>
              )}
            </Button>
          </div>

          <div
            className={cn(
              "flex flex-col gap-5 overflow-hidden transition-all duration-300 lg:gap-7",
              settingsOpen
                ? "max-h-[2000px] opacity-100"
                : "max-h-0 opacity-0 lg:max-h-none lg:opacity-100",
              settingsOpen ? "p-4 pt-0 sm:p-6 sm:pt-4 lg:p-7 lg:pt-6" : "px-4 lg:p-7 lg:pt-6"
            )}
          >
            <form onSubmit={onSubmit} className="space-y-4 sm:space-y-5">
              <div className="space-y-2">
                <Label
                  htmlFor="topic"
                  className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground"
                >
                  Topic
                </Label>
                <Input
                  id="topic"
                  placeholder="e.g. Data Structures"
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  className="h-11 rounded-xl border-border bg-card px-4 text-base sm:text-sm focus-visible:ring-primary/30"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label
                    htmlFor="difficulty"
                    className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground"
                  >
                    Difficulty
                  </Label>
                  <Select value={difficulty} onValueChange={(v) => setDifficulty(v as Difficulty)}>
                    <SelectTrigger
                      id="difficulty"
                      className="h-11 w-full rounded-xl border-border bg-card px-3 text-sm"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Beginner">Beginner</SelectItem>
                      <SelectItem value="Intermediate">Intermediate</SelectItem>
                      <SelectItem value="Advanced">Advanced</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label
                    htmlFor="num"
                    className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground"
                  >
                    Questions
                  </Label>
                  <Input
                    id="num"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={30}
                    step={1}
                    className="h-11 rounded-xl border-border bg-card px-4 text-base sm:text-sm"
                    value={numQuestions === 0 ? "" : numQuestions}
                    onChange={(e) => {
                      const raw = e.target.value;
                      if (raw === "") {
                        setNumQuestions(0);
                        return;
                      }
                      const n = parseInt(raw, 10);
                      if (Number.isNaN(n)) return;
                      setNumQuestions(Math.min(30, Math.max(0, n)));
                    }}
                    onBlur={() => {
                      if (!numQuestions || numQuestions < 1) setNumQuestions(1);
                    }}
                  />
                </div>
              </div>

              <div className="space-y-3 rounded-2xl border border-border bg-card/70 p-3 sm:p-4">
                <label htmlFor="auto" className="flex cursor-pointer items-center justify-between gap-2">
                  <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                    <Sparkles className="h-3.5 w-3.5 shrink-0 text-primary" />
                    Auto-generate
                  </span>
                  <Switch id="auto" checked={autoGenerate} onCheckedChange={setAutoGenerate} />
                </label>
                <label htmlFor="shuffle" className="flex cursor-pointer items-center justify-between gap-2">
                  <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                    <Shuffle className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    Shuffle choices
                  </span>
                  <Switch
                    id="shuffle"
                    checked={shuffleOptions}
                    onCheckedChange={setShuffleOptions}
                  />
                </label>
              </div>

              <Button
                type={autoGenerate ? "button" : "submit"}
                onClick={autoGenerate ? () => run() : undefined}
                disabled={mutation.isPending || !topic.trim()}
                className="h-12 w-full rounded-2xl bg-primary font-display font-semibold text-primary-foreground shadow-lg shadow-primary/20 transition-all hover:bg-primary/90 active:scale-[0.98]"
              >
                {mutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Generating…
                  </>
                ) : mutation.data ? (
                  <>
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Regenerate exam
                  </>
                ) : (
                  <>
                    <Sparkles className="mr-2 h-4 w-4" />
                    Generate exam
                  </>
                )}
              </Button>
            </form>

            {total > 0 && (
              <div className="border-t border-border/70 pt-5">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-sm font-semibold text-foreground">
                    {allRevealed ? "Score" : "Progress"}
                  </span>
                  <span className="text-sm font-bold text-primary">
                    {allRevealed ? `${pct}%` : `${answeredCount}/{total}`}
                  </span>
                </div>
                <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn(
                      "h-full rounded-full transition-all duration-500",
                      allRevealed
                        ? pct >= 70
                          ? "bg-emerald-500"
                          : "bg-amber-500"
                        : "bg-primary"
                    )}
                    style={{ width: `${allRevealed ? pct : progressPct}%` }}
                  />
                </div>
                {allRevealed && (
                  <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1 rounded-lg text-[11px] font-bold uppercase tracking-widest"
                      onClick={() => {
                        setReviewMode((r) => !r);
                        setReviewIndex(0);
                      }}
                    >
                      {reviewMode ? "Exit review" : "Review"}
                    </Button>
                    {correctCount < total && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1 rounded-lg text-[11px] font-bold uppercase tracking-widest"
                        disabled={mutation.isPending}
                        onClick={() => {
                          const wrong = total - correctCount;
                          run(Math.max(1, Math.min(30, wrong)));
                        }}
                      >
                        <RefreshCw
                          className={cn(
                            "mr-1.5 h-3 w-3",
                            mutation.isPending && "animate-spin"
                          )}
                        />
                        Retake wrong
                      </Button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </aside>

        <main className="order-2 flex min-w-0 flex-col gap-4 sm:gap-5 lg:order-none">
          {mutation.isError && (
            <div className="rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {(mutation.error as Error).message}
            </div>
          )}

          {mutation.isPending && (
            <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border bg-card py-16 text-muted-foreground sm:rounded-[28px] sm:py-24">
              <Loader2 className="h-7 w-7 animate-spin text-primary" />
              <p className="text-sm">Drafting your exam…</p>
            </div>
          )}

          {!mutation.isPending && total === 0 && !mutation.isError && (
            <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border bg-card px-4 py-16 text-center text-muted-foreground sm:rounded-[28px] sm:py-24">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <Sparkles className="h-5 w-5" />
              </div>
              <p className="max-w-xs text-sm">
                {autoGenerate
                  ? "Start typing a topic — your exam appears here."
                  : "Set a topic and click Generate exam."}
              </p>
            </div>
          )}

          {!mutation.isPending && total > 0 && (
            <>
              <div className="space-y-3 rounded-2xl border border-border bg-card/80 p-3 sm:p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-foreground">
                      {reviewMode ? "Review" : "Progress"}
                    </span>
                    <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-bold text-primary">
                      {currentIndex + 1} / {total}
                    </span>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {reviewMode
                      ? `${correctCount} correct`
                      : `${answeredCount} of ${total} answered`}
                  </span>
                </div>

                <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-muted sm:h-3">
                  <div
                    className={cn(
                      "h-full rounded-full transition-all duration-500 ease-out",
                      allRevealed
                        ? pct >= 70
                          ? "bg-emerald-500"
                          : "bg-amber-500"
                        : "bg-primary"
                    )}
                    style={{
                      width: `${allRevealed ? pct : Math.max(progressPct, positionPct * 0.15)}%`,
                    }}
                  />
                  {!allRevealed && (
                    <div
                      className="absolute top-0 h-full w-1 rounded-full bg-foreground/80 shadow-sm transition-all duration-300"
                      style={{
                        left: `calc(${positionPct}% - 2px)`,
                      }}
                    />
                  )}
                </div>

                <div className="flex items-center gap-0.5 sm:gap-1">
                  {displayedQuestions.map((qq, i) => {
                    const answered = answers[qq.question_number] !== undefined;
                    const correct =
                      answered && answers[qq.question_number] === qq.correct_answer;
                    const isCurrent = i === currentIndex;
                    return (
                      <button
                        key={qq.question_number}
                        type="button"
                        onClick={() =>
                          reviewMode ? setReviewIndex(i) : setTakingIndex(i)
                        }
                        className={cn(
                          "h-2 min-w-0 flex-1 rounded-full transition-all duration-200 sm:h-2.5",
                          isCurrent && "ring-2 ring-primary ring-offset-1 ring-offset-background",
                          !answered && "bg-muted hover:bg-muted-foreground/30",
                          answered && !reviewMode && !allRevealed && "bg-primary",
                          answered && (reviewMode || allRevealed) && correct && "bg-emerald-500",
                          answered && (reviewMode || allRevealed) && !correct && "bg-destructive"
                        )}
                        aria-label={`Question ${qq.question_number}`}
                        title={`Question ${i + 1}${answered ? (correct ? " · Correct" : " · Incorrect") : ""}`}
                      />
                    );
                  })}
                </div>
              </div>

              {reviewMode ? renderReviewCard() : renderTakingCard()}
            </>
          )}
        </main>
      </div>
    </div>
  );

  function renderTakingCard() {
    const safeIndex = Math.min(takingIndex, total - 1);
    const q = displayedQuestions[safeIndex];
    const selected = answers[q.question_number];
    const isRevealed = revealed[q.question_number];
    const isCorrect = selected === q.correct_answer;

    return (
      <div className="flex flex-1 flex-col gap-4 rounded-2xl border border-border bg-card p-4 shadow-sm sm:gap-6 sm:rounded-[28px] sm:p-8 md:p-10">
        <div>
          <span className="mb-2 block font-display text-[10px] font-bold uppercase tracking-[0.2em] text-primary sm:mb-3 sm:text-xs">
            Question {String(safeIndex + 1).padStart(2, "0")} of{" "}
            {String(total).padStart(2, "0")}
          </span>
          <h2 className="text-[15px] font-semibold leading-snug text-foreground sm:text-lg md:text-xl md:font-bold">
            {q.question}
          </h2>
        </div>

        <div className="space-y-2.5 sm:space-y-3">
          {q.options.map((opt, i) => {
            const letter = String.fromCharCode(65 + i);
            const isSelected = selected === opt;
            const isAnswer = opt === q.correct_answer;
            return (
              <button
                key={i}
                type="button"
                onClick={() => {
                  if (isRevealed) return;
                  setAnswers((a) => ({ ...a, [q.question_number]: opt }));
                  setRevealed((r) => ({ ...r, [q.question_number]: true }));
                }}
                disabled={isRevealed}
                className={cn(
                  "group flex w-full items-start gap-3 rounded-xl border-2 p-3.5 text-left transition-all sm:items-center sm:gap-4 sm:rounded-2xl sm:p-5",
                  "border-border bg-card hover:border-primary/40 hover:bg-primary/5 active:scale-[0.99]",
                  isRevealed && "cursor-default active:scale-100",
                  isRevealed && isAnswer && "border-emerald-500 bg-emerald-500/10 hover:bg-emerald-500/10",
                  isRevealed && isSelected && !isAnswer && "border-destructive bg-destructive/10 hover:bg-destructive/10",
                  isRevealed && !isAnswer && !isSelected && "opacity-60"
                )}
              >
                <span
                  className={cn(
                    "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg font-display text-sm font-bold transition-colors sm:mt-0 sm:h-9 sm:w-9",
                    "bg-muted text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary",
                    isRevealed && isAnswer && "bg-emerald-500 text-white group-hover:bg-emerald-500 group-hover:text-white",
                    isRevealed && isSelected && !isAnswer && "bg-destructive text-white group-hover:bg-destructive group-hover:text-white"
                  )}
                >
                  {letter}
                </span>
                <span className="flex-1 pt-0.5 text-sm font-medium leading-snug text-foreground sm:pt-0 sm:text-base">
                  {opt}
                </span>
                {isRevealed && isAnswer && (
                  <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600 sm:mt-0" />
                )}
                {isRevealed && isSelected && !isAnswer && (
                  <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-destructive sm:mt-0" />
                )}
              </button>
            );
          })}
        </div>

        {isRevealed && (
          <div
            className={cn(
              "animate-in fade-in slide-in-from-bottom-2 rounded-xl border p-4 sm:rounded-2xl sm:p-5",
              isCorrect
                ? "border-emerald-200 bg-emerald-50"
                : "border-amber-200 bg-amber-50"
            )}
          >
            <div
              className={cn(
                "mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider sm:text-xs",
                isCorrect ? "text-emerald-700" : "text-amber-700"
              )}
            >
              {isCorrect ? (
                <CheckCircle2 className="h-4 w-4" />
              ) : (
                <Info className="h-4 w-4" />
              )}
              {isCorrect ? "Correct" : `Answer: ${q.correct_answer}`}
            </div>
            <p
              className={cn(
                "text-sm leading-relaxed",
                isCorrect ? "text-emerald-900" : "text-amber-900"
              )}
            >
              {q.explanation}
            </p>
          </div>
        )}

        {allRevealed && (
          <div
            className={cn(
              "flex flex-col gap-3 rounded-xl border-2 p-4 sm:flex-row sm:items-center sm:gap-4 sm:rounded-2xl sm:p-5",
              pct >= 70
                ? "border-emerald-300 bg-emerald-50"
                : "border-amber-300 bg-amber-50"
            )}
          >
            <div
              className={cn(
                "flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl sm:h-12 sm:w-12",
                pct >= 70
                  ? "bg-emerald-500/15 text-emerald-600"
                  : "bg-amber-500/15 text-amber-700"
              )}
            >
              <Trophy className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-display text-sm font-bold text-foreground">
                {pct >= 70 ? "Congratulations!" : "Keep practicing!"}
              </p>
              <p className="text-xs text-muted-foreground">
                You scored {correctCount}/{total} ({pct}%).
              </p>
            </div>
            <div
              className={cn(
                "self-start rounded-xl px-3 py-1.5 font-display text-sm font-bold sm:self-auto",
                pct >= 70 ? "bg-emerald-500 text-white" : "bg-amber-500 text-white"
              )}
            >
              {pct}%
            </div>
          </div>
        )}

        <div className="mt-auto flex items-center justify-between gap-3 border-t border-border/50 pt-4 sm:border-0 sm:pt-2">
          <Button
            variant="outline"
            disabled={safeIndex === 0}
            onClick={() => setTakingIndex((i) => Math.max(0, i - 1))}
            className="h-11 min-w-[7rem] flex-1 rounded-xl sm:h-10 sm:flex-none"
          >
            <ChevronLeft className="mr-1 h-4 w-4" />
            Previous
          </Button>
          <Button
            disabled={safeIndex === total - 1}
            onClick={() => setTakingIndex((i) => Math.min(total - 1, i + 1))}
            className="h-11 min-w-[7rem] flex-1 rounded-xl bg-foreground font-display font-semibold text-background hover:bg-foreground/90 sm:h-10 sm:flex-none"
          >
            Next
            <ChevronRight className="ml-1 h-4 w-4" />
          </Button>
        </div>
      </div>
    );
  }

  function renderReviewCard() {
    const q = displayedQuestions[reviewIndex];
    const selected = answers[q.question_number];
    const isCorrect = selected === q.correct_answer;

    return (
      <div className="flex flex-1 flex-col gap-4 rounded-2xl border border-border bg-card p-4 shadow-sm sm:gap-6 sm:rounded-[28px] sm:p-8 md:p-10">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
          <div className="min-w-0 flex-1">
            <span className="mb-2 block font-display text-[10px] font-bold uppercase tracking-[0.2em] text-primary sm:mb-3 sm:text-xs">
              Review · Question {String(reviewIndex + 1).padStart(2, "0")} of{" "}
              {String(total).padStart(2, "0")}
            </span>
            <h2 className="text-[15px] font-semibold leading-snug text-foreground sm:text-lg md:text-xl md:font-bold">
              {q.question}
            </h2>
          </div>
          <span
            className={cn(
              "inline-flex w-fit shrink-0 items-center gap-1 rounded-full px-3 py-1 text-xs font-bold",
              isCorrect
                ? "bg-emerald-500/15 text-emerald-700"
                : "bg-destructive/15 text-destructive"
            )}
          >
            {isCorrect ? (
              <CheckCircle2 className="h-3.5 w-3.5" />
            ) : (
              <XCircle className="h-3.5 w-3.5" />
            )}
            {isCorrect ? "Correct" : "Incorrect"}
          </span>
        </div>

        <div className="space-y-2.5 sm:space-y-3">
          {q.options.map((opt, i) => {
            const letter = String.fromCharCode(65 + i);
            const isSelected = selected === opt;
            const isAnswer = opt === q.correct_answer;
            return (
              <div
                key={i}
                className={cn(
                  "flex items-start gap-3 rounded-xl border-2 p-3.5 sm:items-center sm:gap-4 sm:rounded-2xl sm:p-5",
                  "border-border",
                  isAnswer && "border-emerald-500 bg-emerald-500/10",
                  isSelected && !isAnswer && "border-destructive bg-destructive/10",
                  !isAnswer && !isSelected && "opacity-60"
                )}
              >
                <span
                  className={cn(
                    "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg font-display text-sm font-bold sm:mt-0 sm:h-9 sm:w-9",
                    "bg-muted text-muted-foreground",
                    isAnswer && "bg-emerald-500 text-white",
                    isSelected && !isAnswer && "bg-destructive text-white"
                  )}
                >
                  {letter}
                </span>
                <span className="flex-1 pt-0.5 text-sm font-medium leading-snug text-foreground sm:pt-0 sm:text-base">
                  {opt}
                </span>
                {isAnswer && <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600 sm:mt-0" />}
                {isSelected && !isAnswer && (
                  <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-destructive sm:mt-0" />
                )}
              </div>
            );
          })}
        </div>

        <div className="rounded-xl border border-border bg-secondary/60 p-4 sm:rounded-2xl sm:p-5">
          <div className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground sm:text-xs">
            <Info className="h-4 w-4" />
            Explanation
          </div>
          <p className="text-sm leading-relaxed text-foreground">{q.explanation}</p>
        </div>

        <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-border/50 pt-4 sm:border-0 sm:pt-2">
          <Button
            variant="outline"
            disabled={reviewIndex === 0}
            onClick={() => setReviewIndex((i) => Math.max(0, i - 1))}
            className="h-11 min-w-[6.5rem] flex-1 rounded-xl sm:h-10 sm:flex-none"
          >
            <ChevronLeft className="mr-1 h-4 w-4" />
            Previous
          </Button>
          <Button
            variant="ghost"
            onClick={() => setReviewMode(false)}
            className="h-11 order-last w-full rounded-xl sm:order-none sm:h-10 sm:w-auto"
          >
            Exit review
          </Button>
          <Button
            disabled={reviewIndex === total - 1}
            onClick={() => setReviewIndex((i) => Math.min(total - 1, i + 1))}
            className="h-11 min-w-[6.5rem] flex-1 rounded-xl bg-foreground font-display font-semibold text-background hover:bg-foreground/90 sm:h-10 sm:flex-none"
          >
            Next
            <ChevronRight className="ml-1 h-4 w-4" />
          </Button>
        </div>
      </div>
    );
  }
}
