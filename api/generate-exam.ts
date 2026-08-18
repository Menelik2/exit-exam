import type { VercelRequest, VercelResponse } from "@vercel/node";

type ExamQuestion = {
  question_number: number;
  question: string;
  options: string[];
  correct_answer: string;
  explanation: string;
};

type Difficulty = "Beginner" | "Intermediate" | "Advanced";

/** Prefer env override, then try stable public model ids until one works. */
const MODEL_CANDIDATES = [
  process.env.GEMINI_MODEL,
  "gemini-1.5-flash",
  "gemini-1.5-flash-latest",
  "gemini-1.5-flash-8b",
  "gemini-2.0-flash",
  "gemini-2.0-flash-001",
  "gemini-pro",
].filter((m): m is string => Boolean(m && m.trim()));

const DIFFICULTY_GUIDE: Record<Difficulty, string> = {
  Beginner:
    "Focus on definitions, basic concepts, and direct recall. Use clear language. Avoid multi-step reasoning.",
  Intermediate:
    "Test applied understanding, comparisons, and simple problem-solving. Include realistic scenarios.",
  Advanced:
    "Require analysis, edge cases, trade-offs, or multi-step reasoning. Prefer non-obvious but fair distractors.",
};

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    questions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          question_number: { type: "integer" },
          question: { type: "string" },
          options: {
            type: "array",
            items: { type: "string" },
            minItems: 4,
            maxItems: 4,
          },
          correct_answer: { type: "string" },
          explanation: { type: "string" },
        },
        required: [
          "question_number",
          "question",
          "options",
          "correct_answer",
          "explanation",
        ],
      },
    },
  },
  required: ["questions"],
} as const;

function buildSystemInstruction(difficulty: Difficulty, count: number): string {
  return [
    "You are a senior examiner who writes high-quality multiple-choice questions for academic and professional tests.",
    "Your output must be valid structured data only — never markdown, never commentary.",
    "",
    "Quality standards:",
    `- Write exactly ${count} questions.`,
    "- Each question has exactly 4 options.",
    "- correct_answer must be copied verbatim from one of the options.",
    "- Options must not include letter prefixes (A/B/C/D) or numbering.",
    "- Distractors must be plausible and related to the topic; avoid joke or obviously wrong options.",
    "- Only one option is unambiguously correct.",
    "- Explanations: 1–3 sentences stating why the correct option is right and briefly why a common mistake is wrong.",
    "- Cover distinct subtopics; do not cluster near-identical questions.",
    "- Prefer precise, exam-style wording over conversational filler.",
    "",
    `Difficulty target (${difficulty}): ${DIFFICULTY_GUIDE[difficulty]}`,
  ].join("\n");
}

function buildUserPrompt(params: {
  topic: string;
  difficulty: Difficulty;
  numQuestions: number;
  nonce: string;
  avoid: string[];
}): string {
  const { topic, difficulty, numQuestions, nonce, avoid } = params;

  const lines: string[] = [
    `Topic: ${topic}`,
    `Difficulty: ${difficulty}`,
    `Number of questions: ${numQuestions}`,
    `Variation seed: ${nonce}`,
    "",
    "Task: Generate a fresh exam set for this topic at the specified difficulty.",
  ];

  if (avoid.length > 0) {
    const recent = avoid.slice(-40).map((q, i) => `${i + 1}. ${q.slice(0, 180)}`);
    lines.push(
      "",
      "Do NOT repeat or closely rephrase any of these prior question stems:",
      ...recent,
      "Choose different subtopics, scenarios, and wording.",
    );
  }

  lines.push(
    "",
    "Return JSON with key \"questions\" only. Each item needs:",
    "question_number, question, options (4 strings), correct_answer, explanation.",
  );

  return lines.join("\n");
}

async function callGemini(params: {
  apiKey: string;
  model: string;
  systemInstruction: string;
  userPrompt: string;
  temperature: number;
  numQuestions: number;
  useSchema: boolean;
}): Promise<{ ok: true; text: string } | { ok: false; status: number; body: string }> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(params.model)}:generateContent?key=${encodeURIComponent(params.apiKey)}`;

  const generationConfig: Record<string, unknown> = {
    temperature: params.temperature,
    topP: 0.9,
    maxOutputTokens: Math.min(8192, 400 + params.numQuestions * 350),
    responseMimeType: "application/json",
  };
  if (params.useSchema) {
    generationConfig.responseSchema = RESPONSE_SCHEMA;
  }

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: params.systemInstruction }],
      },
      contents: [{ role: "user", parts: [{ text: params.userPrompt }] }],
      generationConfig,
    }),
  });

  const body = await response.text();
  if (!response.ok) {
    return { ok: false, status: response.status, body };
  }

  let json: {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  try {
    json = JSON.parse(body);
  } catch {
    return { ok: false, status: 502, body: "Invalid JSON from Gemini" };
  }

  const text =
    json?.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  if (!text) {
    return { ok: false, status: 502, body: "Empty candidate text" };
  }
  return { ok: true, text };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error:
        "Server is missing GEMINI_API_KEY. Add it in Vercel → Project → Settings → Environment Variables, then redeploy.",
    });
  }

  let body: Record<string, unknown> = {};
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body ?? {});
  } catch {
    return res.status(400).json({ error: "Invalid JSON body." });
  }

  const topic = String(body?.topic ?? "").trim();
  const difficulty = body?.difficulty as Difficulty;
  const numQuestions = Number(body?.numQuestions);
  const nonce = body?.nonce ? String(body.nonce) : String(Date.now());
  const avoid: string[] = Array.isArray(body?.avoid) ? (body.avoid as string[]).slice(-200) : [];

  if (!topic || topic.length > 200) {
    return res.status(400).json({ error: "Topic is required (max 200 chars)." });
  }
  if (!["Beginner", "Intermediate", "Advanced"].includes(String(difficulty))) {
    return res.status(400).json({ error: "Invalid difficulty." });
  }
  if (!Number.isInteger(numQuestions) || numQuestions < 1 || numQuestions > 30) {
    return res.status(400).json({ error: "numQuestions must be 1–30." });
  }

  const systemInstruction = buildSystemInstruction(difficulty, numQuestions);
  const userPrompt = buildUserPrompt({
    topic,
    difficulty,
    numQuestions,
    nonce,
    avoid,
  });

  const temperature =
    difficulty === "Beginner" ? 0.55 : difficulty === "Intermediate" ? 0.7 : 0.85;

  // Deduplicate while preserving order
  const models = [...new Set(MODEL_CANDIDATES)];

  try {
    let lastError = "";
    let rawText = "";

    for (const model of models) {
      // Try with schema first; some older models reject responseSchema → retry without
      for (const useSchema of [true, false]) {
        const result = await callGemini({
          apiKey,
          model,
          systemInstruction,
          userPrompt,
          temperature,
          numQuestions,
          useSchema,
        });

        if (result.ok) {
          rawText = result.text;
          break;
        }

        lastError = `${model} (${result.status}): ${result.body.slice(0, 240)}`;
        console.error("Gemini attempt failed", lastError);

        // Model not found → try next model
        if (result.status === 404) break;
        // Bad request may be schema-related → try without schema once
        if (result.status === 400 && useSchema) continue;
        // Auth / hard failures → stop
        if (result.status === 403 || result.status === 401) {
          return res.status(502).json({
            error:
              "Gemini rejected the API key. Check GEMINI_API_KEY and that Generative Language API is enabled.",
          });
        }
        if (result.status === 429) {
          return res.status(429).json({ error: "Gemini rate limit exceeded. Try again shortly." });
        }
      }
      if (rawText) break;
    }

    if (!rawText) {
      return res.status(502).json({
        error: `Gemini request failed (no available model). Last error: ${lastError || "unknown"}`,
      });
    }

    let parsed: { questions?: ExamQuestion[] };
    try {
      parsed = JSON.parse(rawText);
    } catch {
      const match = rawText.match(/\{[\s\S]*\}/);
      if (!match) {
        return res.status(502).json({ error: "Gemini did not return valid JSON." });
      }
      parsed = JSON.parse(match[0]);
    }

    if (!parsed?.questions || !Array.isArray(parsed.questions) || parsed.questions.length === 0) {
      return res.status(502).json({ error: "Gemini did not return any questions." });
    }

    const questions: ExamQuestion[] = parsed.questions.map((q, i) => {
      const options = Array.isArray(q.options)
        ? q.options.map((o) => String(o).replace(/^[A-D][\).:\-]\s*/i, "").trim()).slice(0, 4)
        : [];
      let correct = String(q.correct_answer ?? "").replace(/^[A-D][\).:\-]\s*/i, "").trim();

      if (options.length === 4 && !options.includes(correct)) {
        const lower = correct.toLowerCase();
        const hit = options.find((o) => o.toLowerCase() === lower);
        if (hit) correct = hit;
        else {
          const partial = options.find(
            (o) => o.toLowerCase().includes(lower) || lower.includes(o.toLowerCase()),
          );
          if (partial) correct = partial;
        }
      }

      return {
        question_number: Number(q.question_number) || i + 1,
        question: String(q.question ?? "").trim(),
        options,
        correct_answer: correct,
        explanation: String(q.explanation ?? "").trim(),
      };
    });

    for (const q of questions) {
      if (!q.question || q.options.length !== 4 || !q.correct_answer) {
        return res.status(502).json({ error: "Gemini returned incomplete question data." });
      }
      if (!q.options.includes(q.correct_answer)) {
        return res.status(502).json({
          error: "Gemini returned a correct_answer that does not match any option.",
        });
      }
    }

    return res.status(200).json({ questions });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      error: "Unable to generate exam right now. Please try again shortly.",
    });
  }
}
