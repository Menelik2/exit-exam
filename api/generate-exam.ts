import type { VercelRequest, VercelResponse } from "@vercel/node";

type ExamQuestion = {
  question_number: number;
  question: string;
  options: string[];
  correct_answer: string;
  explanation: string;
};

const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.0-flash";

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
  const difficulty = body?.difficulty;
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

  const avoidBlock =
    avoid.length > 0
      ? `\n\nSTRICT NO-REPEAT RULE: Do NOT repeat, rephrase, or produce semantically equivalent versions of any of these previously generated questions. Previously generated questions:\n${avoid.map((q, i) => `${i + 1}. ${q}`).join("\n")}`
      : "";

  const prompt = `You are an expert exam generator for computer science and academic subjects.

Generate exactly ${numQuestions} multiple-choice questions.

Topic: ${topic}
Difficulty: ${difficulty}
Variation seed: ${nonce}
${avoidBlock}

Return ONLY valid JSON (no markdown fences, no extra text) with this exact shape:
{
  "questions": [
    {
      "question_number": 1,
      "question": "...",
      "options": ["option A text", "option B text", "option C text", "option D text"],
      "correct_answer": "exact text of the correct option",
      "explanation": "why the correct answer is right"
    }
  ]
}

Rules:
- Exactly 4 options per question
- correct_answer must match one option string exactly
- Questions must fit the difficulty level
- Do not number options inside the option strings`;

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(apiKey)}`;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.8,
          responseMimeType: "application/json",
        },
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      if (response.status === 429) {
        return res.status(429).json({ error: "Gemini rate limit exceeded. Try again shortly." });
      }
      if (response.status === 400 || response.status === 403) {
        return res.status(502).json({
          error: "Gemini rejected the request. Check that GEMINI_API_KEY is valid and the Generative Language API is enabled.",
        });
      }
      console.error("Gemini error", response.status, text);
      return res.status(502).json({ error: `Gemini request failed (${response.status}).` });
    }

    const json = await response.json();
    const rawText =
      json?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("") ??
      "";

    if (!rawText) {
      return res.status(502).json({ error: "Gemini returned an empty response." });
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

    const questions: ExamQuestion[] = parsed.questions.map((q, i) => ({
      question_number: Number(q.question_number) || i + 1,
      question: String(q.question ?? ""),
      options: Array.isArray(q.options) ? q.options.map(String).slice(0, 4) : [],
      correct_answer: String(q.correct_answer ?? ""),
      explanation: String(q.explanation ?? ""),
    }));

    for (const q of questions) {
      if (!q.question || q.options.length !== 4 || !q.correct_answer) {
        return res.status(502).json({ error: "Gemini returned incomplete question data." });
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
