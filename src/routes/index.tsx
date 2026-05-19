import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { generateExam, type ExamQuestion } from "@/lib/exam.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, GraduationCap, CheckCircle2, XCircle, Sparkles } from "lucide-react";
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

function ExamGeneratorPage() {
  const [topic, setTopic] = useState("");
  const [difficulty, setDifficulty] = useState<Difficulty>("Intermediate");
  const [numQuestions, setNumQuestions] = useState(5);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [revealed, setRevealed] = useState<Record<number, boolean>>({});

  const generateFn = useServerFn(generateExam);
  const mutation = useMutation({
    mutationFn: (vars: { topic: string; difficulty: Difficulty; numQuestions: number }) =>
      generateFn({ data: vars }),
    onSuccess: () => {
      setAnswers({});
      setRevealed({});
    },
  });

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!topic.trim()) return;
    mutation.mutate({ topic: topic.trim(), difficulty, numQuestions });
  };

  const questions: ExamQuestion[] = mutation.data?.questions ?? [];

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
            <form onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end">
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
                  min={1}
                  max={20}
                  className="w-[110px]"
                  value={numQuestions}
                  onChange={(e) => setNumQuestions(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
                />
              </div>
              <Button type="submit" disabled={mutation.isPending || !topic.trim()}>
                {mutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Generating
                  </>
                ) : (
                  "Generate exam"
                )}
              </Button>
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

        {!mutation.isPending && questions.length > 0 && (
          <section className="space-y-5">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold">Exam preview</h2>
              <span className="text-xs text-muted-foreground">
                {questions.length} question{questions.length === 1 ? "" : "s"} · {difficulty}
              </span>
            </div>

            {questions.map((q) => {
              const selected = answers[q.question_number];
              const isRevealed = revealed[q.question_number];
              const isCorrect = selected === q.correct_answer;
              return (
                <Card key={q.question_number}>
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
                            onClick={() =>
                              setAnswers((a) => ({ ...a, [q.question_number]: opt }))
                            }
                            disabled={isRevealed}
                            className={cn(
                              "flex items-start gap-3 rounded-md border border-border px-3 py-2 text-left text-sm transition-colors",
                              "hover:bg-accent hover:text-accent-foreground",
                              isSelected && !isRevealed && "border-primary bg-primary/5",
                              isRevealed && isAnswer && "border-green-500/60 bg-green-500/10",
                              isRevealed && isSelected && !isAnswer && "border-destructive/60 bg-destructive/10",
                            )}
                          >
                            <span className="font-mono text-xs font-semibold text-muted-foreground">
                              {letter}.
                            </span>
                            <span className="flex-1">{opt}</span>
                            {isRevealed && isAnswer && (
                              <CheckCircle2 className="h-4 w-4 text-green-600" />
                            )}
                            {isRevealed && isSelected && !isAnswer && (
                              <XCircle className="h-4 w-4 text-destructive" />
                            )}
                          </button>
                        );
                      })}
                    </div>

                    {!isRevealed ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={!selected}
                        onClick={() =>
                          setRevealed((r) => ({ ...r, [q.question_number]: true }))
                        }
                      >
                        Check answer
                      </Button>
                    ) : (
                      <div
                        className={cn(
                          "rounded-md border px-3 py-2 text-sm",
                          isCorrect
                            ? "border-green-500/40 bg-green-500/5"
                            : "border-destructive/40 bg-destructive/5",
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
              );
            })}
          </section>
        )}

        {!mutation.isPending && !mutation.data && !mutation.isError && (
          <div className="rounded-lg border border-dashed border-border py-16 text-center text-sm text-muted-foreground">
            Submit a topic, difficulty, and question count to preview an exam.
          </div>
        )}
      </main>
    </div>
  );
}
