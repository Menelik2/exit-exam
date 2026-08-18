import { z } from "zod";

const InputSchema = z.object({
  topic: z.string().min(1).max(200),
  difficulty: z.enum(["Beginner", "Intermediate", "Advanced"]),
  numQuestions: z.number().int().min(1).max(30),
  nonce: z.string().optional(),
  avoid: z.array(z.string().min(1).max(500)).max(500).optional(),
});

export type ExamQuestion = {
  question_number: number;
  question: string;
  options: string[];
  correct_answer: string;
  explanation: string;
};

export type GenerateExamInput = z.infer<typeof InputSchema>;

export async function generateExam(
  input: GenerateExamInput,
): Promise<{ questions: ExamQuestion[] }> {
  const data = InputSchema.parse(input);

  const response = await fetch("/api/generate-exam", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message =
      typeof payload?.error === "string"
        ? payload.error
        : "Unable to generate exam right now. Please try again shortly.";
    throw new Error(message);
  }

  return payload as { questions: ExamQuestion[] };
}
