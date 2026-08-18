import type { VercelRequest, VercelResponse } from "@vercel/node";

type ExamQuestion = {
  question_number: number;
  question: string;
  options: string[];
  correct_answer: string;
  explanation: string;
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: "Unable to generate exam right now. Please try again shortly.",
    });
  }

  const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  const topic = String(body?.topic ?? "").trim();
  const difficulty = body?.difficulty;
  const numQuestions = Number(body?.numQuestions);
  const nonce = body?.nonce ? String(body.nonce) : String(Date.now());
  const avoid: string[] = Array.isArray(body?.avoid) ? body.avoid.slice(-200) : [];

  if (!topic || topic.length > 200) {
    return res.status(400).json({ error: "Topic is required (max 200 chars)." });
  }
  if (!["Beginner", "Intermediate", "Advanced"].includes(difficulty)) {
    return res.status(400).json({ error: "Invalid difficulty." });
  }
  if (!Number.isInteger(numQuestions) || numQuestions < 1 || numQuestions > 30) {
    return res.status(400).json({ error: "numQuestions must be 1–30." });
  }

  const systemPrompt = `You are an expert Computer Science professor and exam generator. Your task is to generate a multiple-choice exam based on the topic and difficulty level provided by the user.

You must respond ONLY with a JSON object. Do not include any conversational text before or after the JSON.

The JSON structure must be an object with a "questions" array, where each item contains:
- "question_number": (int) The number of the question.
- "question": (string) The exam question.
- "options": (array of strings) Exactly 4 multiple-choice options.
- "correct_answer": (string) The exact string of the correct option (must match one option verbatim).
- "explanation": (string) A detailed explanation of why the correct answer is right, and why common misconceptions are incorrect.`;

  const avoidBlock =
    avoid.length > 0
      ? `\n\nSTRICT NO-REPEAT RULE: Do NOT repeat, rephrase, or produce semantically equivalent versions of any of these previously generated questions. Pick entirely different subtopics, angles, scenarios, and wording. Previously generated questions (one per line):\n${avoid.map((q, i) => `${i + 1}. ${q}`).join("\n")}`
      : "";

  const userPrompt = `Topic: ${topic}
Difficulty: ${difficulty}
Number of Questions: ${numQuestions}
Variation seed: ${nonce} — generate a fresh, distinct set of questions different from any prior generation. Vary subtopics, phrasing, and which option is correct.${avoidBlock}`;

  try {
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "return_exam",
              description: "Return the generated multiple-choice exam",
              parameters: {
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
                      additionalProperties: false,
                    },
                  },
                },
                required: ["questions"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "return_exam" } },
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return res.status(429).json({ error: "Rate limit exceeded. Please try again in a moment." });
      }
      if (response.status === 402) {
        return res.status(402).json({ error: "AI credits exhausted. Please add credits to continue." });
      }
      const text = await response.text();
      return res.status(502).json({ error: `AI request failed: ${response.status} ${text}` });
    }

    const json = await response.json();
    const toolCall = json.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall?.function?.arguments) {
      return res.status(502).json({ error: "AI did not return structured exam data" });
    }

    const parsed = JSON.parse(toolCall.function.arguments) as { questions: ExamQuestion[] };
    return res.status(200).json({ questions: parsed.questions });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      error: "Unable to generate exam right now. Please try again shortly.",
    });
  }
}
