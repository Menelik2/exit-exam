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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  Eye,
  EyeOff,
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
  // Deterministic Fisher–Yates with a simple LCG so re-renders stay stable.
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
  const [peeked, setPeeked] = useState<Record<number, boolean>>({});

  // Persist settings to localStorage whenever they change.
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
  const mutation = useMutation({
    mutationFn: (vars: {
      topic: string;
      difficulty: Difficulty;
      numQuestions: number;
      nonce: string;
    }) => generateFn({ data: vars }),
    onSuccess: () => {
      setAnswers({});
      setRevealed({});
      setPeeked({});
      setReviewMode(false);
      setReviewIndex(0);
      setTakingIndex(0);
      setShuffleSeed((s) => s + 1);
    },
  });

  const run = useCallback(() => {
    const t = topic.trim();
    if (!t) return;
    const nonce = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    mutation.mutate({ topic: t, difficulty, numQuestions, nonce });
  }, [topic, difficulty, numQuestions, mutation]);

  // Reset answers/revealed immediately when inputs change so old selections don't linger.
  useEffect(() => {
    setAnswers({});
    setRevealed({});
    setReviewMode(false);
    setReviewIndex(0);
    setTakingIndex(0);
  }, [topic, difficulty, numQuestions]);

  // Auto-generate on input changes (debounced).
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firstRunRef = useRef(true);
  useEffect(() => {
    if (!autoGenerate) return;
    if (!topic.trim()) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    // Slightly longer delay on the very first keystroke so users can finish typing the topic.
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

  // Apply shuffle while keeping correct_answer tied to the option string.
  const displayedQuestions = useMemo(() => {
    if (!shuffleOptions) return rawQuestions;
    return rawQuestions.map((q) => ({
      ...q,
      options: shuffle(q.options, shuffleSeed + q.question_number * 7919),
    }));
  }, [rawQuestions, shuffleOptions, shuffleSeed]);

  // Reset per-question state when the shuffled order changes so prior selections don't mislabel.
  useEffect(() => {
    setAnswers({});
    setRevealed({});
    setReviewMode(false);
    setReviewIndex(0);
    setTakingIndex(0);
  }, [shuffleOptions, shuffleSeed]);

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-4xl items-center gap-3 px-4 py-5">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <GraduationCap className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Exam Generator</h1>
            <p className="text-xs text-muted-foreground">
              Instant multiple-choice exam previews powered by AI
            </p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-8">
        <Card className="mb-8">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              Create your exam
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-[1fr_auto_auto]">
                <div className="space-y-2">
                  <Label htmlFor="topic">Topic</Label>
                  <Input
                    id="topic"
                    placeholder="e.g. Data Structures, Networking"
                    value={topic}
                    onChange={(e) => setTopic(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="difficulty">Difficulty</Label>
                  <Select value={difficulty} onValueChange={(v) => setDifficulty(v as Difficulty)}>
                    <SelectTrigger id="difficulty" className="w-[160px]">
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
                  <Label htmlFor="num"># Questions</Label>
                  <Input
                    id="num"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={30}
                    step={1}
                    className="w-[110px]"
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

              <div className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-md border border-border bg-muted/30 px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <Switch
                    id="auto"
                    checked={autoGenerate}
                    onCheckedChange={setAutoGenerate}
                  />
                  <Label htmlFor="auto" className="cursor-pointer text-sm font-normal">
                    Auto-generate on change
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    id="shuffle"
                    checked={shuffleOptions}
                    onCheckedChange={setShuffleOptions}
                  />
                  <Label htmlFor="shuffle" className="cursor-pointer text-sm font-normal">
                    <span className="inline-flex items-center gap-1.5">
                      <Shuffle className="h-3.5 w-3.5" />
                      Shuffle answer choices
                    </span>
                  </Label>
                </div>
                <div className="ml-auto flex items-center gap-2">
                  {mutation.data && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={mutation.isPending || !topic.trim()}
                      onClick={run}
                    >
                      <RefreshCw
                        className={cn("mr-2 h-4 w-4", mutation.isPending && "animate-spin")}
                      />
                      Regenerate exam
                    </Button>
                  )}
                  {!autoGenerate && (
                    <Button type="submit" size="sm" disabled={mutation.isPending || !topic.trim()}>
                      {mutation.isPending ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Generating
                        </>
                      ) : (
                        "Generate exam"
                      )}
                    </Button>
                  )}
                </div>
              </div>
            </form>
          </CardContent>
        </Card>

        {mutation.isError && (
          <div className="mb-6 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {(mutation.error as Error).message}
          </div>
        )}

        {mutation.isPending && (
          <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border py-16 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin" />
            <p className="text-sm">Drafting your exam…</p>
          </div>
        )}

        {!mutation.isPending && displayedQuestions.length > 0 && (
          <section className="space-y-5">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold">{reviewMode ? "Exam review" : "Exam preview"}</h2>
              <span className="text-xs text-muted-foreground">
                {displayedQuestions.length} question
                {displayedQuestions.length === 1 ? "" : "s"} · {difficulty}
              </span>
            </div>

            {/* Results summary — shows when every question has been revealed */}
            {(() => {
              const total = displayedQuestions.length;
              const revealedCount = displayedQuestions.filter(
                (q) => revealed[q.question_number]
              ).length;
              const allRevealed = revealedCount === total && total > 0;
              const correctCount = displayedQuestions.filter(
                (q) =>
                  revealed[q.question_number] &&
                  answers[q.question_number] === q.correct_answer
              ).length;
              const pct = total > 0 ? Math.round((correctCount / total) * 100) : 0;
              if (!allRevealed) return null;
              const passed = pct >= 70;
              return (
                <Card
                  className={cn(
                    "border-2",
                    passed
                      ? "border-green-500/40 bg-green-500/5"
                      : "border-amber-500/40 bg-amber-500/5"
                  )}
                >
                  <CardContent className="flex items-center gap-4 px-5 py-4">
                    <div
                      className={cn(
                        "flex h-10 w-10 shrink-0 items-center justify-center rounded-full",
                        passed ? "bg-green-500/15 text-green-600" : "bg-amber-500/15 text-amber-600"
                      )}
                    >
                      <Trophy className="h-5 w-5" />
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-semibold">
                        {passed ? "Congratulations!" : "Keep practicing!"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        You scored {correctCount}/{total} ({pct}%).
                        {passed
                          ? " You passed the exam."
                          : " Try reviewing the explanations and retake the exam."}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          setReviewMode(true);
                          setReviewIndex(0);
                        }}
                      >
                        Review exam
                      </Button>
                      <div
                        className={cn(
                          "rounded-md px-3 py-1 text-sm font-bold",
                          passed
                            ? "bg-green-500/10 text-green-700"
                            : "bg-amber-500/10 text-amber-700"
                        )}
                      >
                        {pct}%
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })()}


            {reviewMode ? (
              <div className="space-y-4">
                {/* Progress dots */}
                <div className="flex items-center gap-1.5">
                  {displayedQuestions.map((q, i) => {
                    const correct = answers[q.question_number] === q.correct_answer;
                    const isCurrent = i === reviewIndex;
                    return (
                      <button
                        key={q.question_number}
                        onClick={() => setReviewIndex(i)}
                        className={cn(
                          "h-2.5 w-2.5 rounded-full transition-all",
                          correct ? "bg-green-500" : "bg-destructive",
                          isCurrent && "scale-125 ring-2 ring-primary ring-offset-2 ring-offset-background"
                        )}
                        aria-label={`Jump to question ${q.question_number}`}
                      />
                    );
                  })}
                  <span className="ml-auto text-xs text-muted-foreground">
                    Question {reviewIndex + 1} of {displayedQuestions.length}
                  </span>
                </div>

                {(() => {
                  const q = displayedQuestions[reviewIndex];
                  const selected = answers[q.question_number];
                  const isCorrect = selected === q.correct_answer;
                  return (
                    <Card>
                      <CardHeader className="pb-2">
                        <div className="flex items-start justify-between gap-3">
                          <CardTitle className="text-base">
                            <span className="mr-2 text-muted-foreground">
                              Q{q.question_number}.
                            </span>
                            {q.question}
                          </CardTitle>
                          <span
                            className={cn(
                              "inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium",
                              isCorrect
                                ? "bg-green-500/10 text-green-600"
                                : "bg-destructive/10 text-destructive"
                            )}
                          >
                            {isCorrect ? (
                              <CheckCircle2 className="h-3 w-3" />
                            ) : (
                              <XCircle className="h-3 w-3" />
                            )}
                            {isCorrect ? "Correct" : "Incorrect"}
                          </span>
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        <div className="grid gap-2">
                          {q.options.map((opt, i) => {
                            const letter = String.fromCharCode(65 + i);
                            const isSelected = selected === opt;
                            const isAnswer = opt === q.correct_answer;
                            return (
                              <div
                                key={i}
                                className={cn(
                                  "flex items-start gap-3 rounded-md border px-3 py-2 text-left text-sm",
                                  isAnswer && "border-green-500/60 bg-green-500/10",
                                  isSelected && !isAnswer && "border-destructive/60 bg-destructive/10",
                                  !isSelected && !isAnswer && "border-border opacity-50"
                                )}
                              >
                                <span className="font-mono text-xs font-semibold text-muted-foreground">
                                  {letter}.
                                </span>
                                <span className="flex-1">{opt}</span>
                                {isAnswer && (
                                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                                )}
                                {isSelected && !isAnswer && (
                                  <XCircle className="h-4 w-4 text-destructive" />
                                )}
                              </div>
                            );
                          })}
                        </div>
                        <div
                          className={cn(
                            "rounded-md border px-3 py-2 text-sm",
                            isCorrect
                              ? "border-green-500/40 bg-green-500/5"
                              : "border-destructive/40 bg-destructive/5"
                          )}
                        >
                          <p className="mb-1 font-medium">Answer: {q.correct_answer}</p>
                          <p className="text-muted-foreground">{q.explanation}</p>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })()}

                <div className="flex items-center justify-between">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={reviewIndex === 0}
                    onClick={() => setReviewIndex((i) => i - 1)}
                  >
                    <ChevronLeft className="mr-1 h-4 w-4" />
                    Previous
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    {reviewIndex + 1} / {displayedQuestions.length}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={reviewIndex === displayedQuestions.length - 1}
                    onClick={() => setReviewIndex((i) => i + 1)}
                  >
                    Next
                    <ChevronRight className="ml-1 h-4 w-4" />
                  </Button>
                </div>

                <div className="flex justify-center">
                  <Button variant="ghost" size="sm" onClick={() => setReviewMode(false)}>
                    Exit review
                  </Button>
                </div>
              </div>
            ) : (() => {
              const total = displayedQuestions.length;
              const safeIndex = Math.min(takingIndex, total - 1);
              const q = displayedQuestions[safeIndex];
              const selected = answers[q.question_number];
              const isRevealed = revealed[q.question_number];
              const isPeeking = !!peeked[q.question_number] && !isRevealed;
              const showAnswer = isRevealed || isPeeking;
              const isCorrect = selected === q.correct_answer;
              const answeredCount = displayedQuestions.filter(
                (qq) => answers[qq.question_number] !== undefined
              ).length;
              return (
                <div className="space-y-4">
                  {/* Progress dots — clickable */}
                  <div className="flex items-center gap-1.5">
                    {displayedQuestions.map((qq, i) => {
                      const answered = answers[qq.question_number] !== undefined;
                      const isCurrent = i === safeIndex;
                      return (
                        <button
                          key={qq.question_number}
                          type="button"
                          onClick={() => setTakingIndex(i)}
                          className={cn(
                            "h-2.5 w-2.5 rounded-full transition-all",
                            answered ? "bg-primary" : "bg-muted-foreground/30",
                            isCurrent && "scale-125 ring-2 ring-primary ring-offset-2 ring-offset-background"
                          )}
                          aria-label={`Go to question ${qq.question_number}`}
                        />
                      );
                    })}
                    <span className="ml-auto text-xs text-muted-foreground">
                      Question {safeIndex + 1} of {total} · {answeredCount}/{total} answered
                    </span>
                  </div>

                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">
                        <span className="mr-2 text-muted-foreground">Q{q.question_number}.</span>
                        {q.question}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="grid gap-2">
                        {q.options.map((opt, i) => {
                          const letter = String.fromCharCode(65 + i);
                          const isSelected = selected === opt;
                          const isAnswer = opt === q.correct_answer;
                          return (
                            <button
                              key={i}
                              type="button"
                              onClick={() => {
                                setAnswers((a) => ({ ...a, [q.question_number]: opt }));
                                setRevealed((r) => ({ ...r, [q.question_number]: true }));
                              }}
                              disabled={isRevealed}
                              className={cn(
                                "flex items-start gap-3 rounded-md border border-border px-3 py-2 text-left text-sm transition-colors",
                                "hover:bg-accent hover:text-accent-foreground",
                                isSelected && !showAnswer && "border-primary bg-primary/5",
                                showAnswer && isAnswer && "border-green-500/60 bg-green-500/10",
                                showAnswer &&
                                  isSelected &&
                                  !isAnswer &&
                                  "border-destructive/60 bg-destructive/10"
                              )}
                            >
                              <span className="font-mono text-xs font-semibold text-muted-foreground">
                                {letter}.
                              </span>
                              <span className="flex-1">{opt}</span>
                              {showAnswer && isAnswer && (
                                <CheckCircle2 className="h-4 w-4 text-green-600" />
                              )}
                              {showAnswer && isSelected && !isAnswer && (
                                <XCircle className="h-4 w-4 text-destructive" />
                              )}
                            </button>
                          );
                        })}
                      </div>

                      {isPeeking && !isRevealed && (
                        <div className="rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-sm">
                          <p className="mb-1 font-medium text-amber-700">
                            Preview — Answer: {q.correct_answer}
                          </p>
                          <p className="text-muted-foreground">{q.explanation}</p>
                        </div>
                      )}

                      {isRevealed && (
                        <div
                          className={cn(
                            "rounded-md border px-3 py-2 text-sm",
                            isCorrect
                              ? "border-green-500/40 bg-green-500/5"
                              : "border-destructive/40 bg-destructive/5"
                          )}
                        >
                          <p className="mb-1 font-medium">
                            {isCorrect ? "Correct" : "Incorrect"} — Answer: {q.correct_answer}
                          </p>
                          <p className="text-muted-foreground">{q.explanation}</p>
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  <div className="flex items-center justify-between gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={safeIndex === 0}
                      onClick={() => setTakingIndex((i) => Math.max(0, i - 1))}
                    >
                      <ChevronLeft className="mr-1 h-4 w-4" />
                      Previous
                    </Button>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setAnswers({});
                          setRevealed({});
                          setPeeked({});
                          setTakingIndex(0);
                        }}
                      >
                        Exit exam
                      </Button>
                      {safeIndex === total - 1 ? (
                        <Button
                          size="sm"
                          onClick={() => {
                            const allRevealed: Record<number, boolean> = {};
                            displayedQuestions.forEach((qq) => {
                              allRevealed[qq.question_number] = true;
                            });
                            setRevealed(allRevealed);
                          }}
                        >
                          Submit exam
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          onClick={() => {
                            setPeeked((p) => ({ ...p, [q.question_number]: false }));
                            setTakingIndex((i) => Math.min(total - 1, i + 1));
                          }}
                        >
                          Next
                          <ChevronRight className="ml-1 h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })()}
          </section>
        )}

        {!mutation.isPending && !mutation.data && !mutation.isError && (
          <div className="rounded-lg border border-dashed border-border py-16 text-center text-sm text-muted-foreground">
            {autoGenerate
              ? "Start typing a topic — your exam will preview automatically."
              : "Submit a topic, difficulty, and question count to preview an exam."}
          </div>
        )}
      </main>
    </div>
  );
}
