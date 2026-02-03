// api/elevenlabs.js
// Minimal pipeline:
// POST { transcript, timing, metrics, scenario } ->
//   1) Scoring Engine (returns JSON)
//   2) Feedback Engine (returns text)
//   3) Returns narrator-ready fields

const OPENAI_URL = "https://api.openai.com/v1/responses";

// Put your colleague prompts EXACTLY as-is inside these template strings.
// Do not add extra commentary inside the scoring prompt.
const SCORING_ENGINE_SYSTEM_PROMPT = `
PASTE THE ENTIRE "Scoring Engine_System Prompt" HERE (exactly).
`;

const FEEDBACK_ENGINE_SYSTEM_PROMPT = `
PASTE THE ENTIRE "Feedback Engine_System Prompt" HERE (exactly).
`;

// ---------- helpers ----------
function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch (_) {
    // Try to recover: extract first {...} block
    const firstBrace = text.indexOf("{");
    const lastBrace = text.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      const maybe = text.slice(firstBrace, lastBrace + 1);
      return JSON.parse(maybe);
    }
    throw new Error("Could not parse JSON from model output.");
  }
}

function extractOutputText(responseJson) {
  // Responses API returns "output" items. We'll gather any message output_text.
  // This extractor is intentionally defensive.
  const out = responseJson?.output;
  if (!Array.isArray(out)) return "";

  let text = "";
  for (const item of out) {
    if (item?.type === "message" && Array.isArray(item?.content)) {
      for (const c of item.content) {
        if (c?.type === "output_text" && typeof c?.text === "string") {
          text += c.text;
        }
      }
    }
  }
  return text.trim();
}

function parseFeedbackSections(feedbackText) {
  // Expected (plain text):
  // Highlights — bullets
  // Growth Focus — bullets
  // Next Rep Challenge — one line
  //
  // We'll be flexible with ":" / "—" and bullet styles.
  const lines = feedbackText.split("\n").map((l) => l.trim()).filter(Boolean);

  let section = null;
  const highlights = [];
  const growth = [];
  let challenge = "";

  const isHeader = (l) =>
    /^highlights\b/i.test(l) ||
    /^growth focus\b/i.test(l) ||
    /^next rep challenge\b/i.test(l);

  for (const line of lines) {
    if (isHeader(line)) {
      if (/^highlights\b/i.test(line)) section = "highlights";
      else if (/^growth focus\b/i.test(line)) section = "growth";
      else if (/^next rep challenge\b/i.test(line)) section = "challenge";
      continue;
    }

    const cleaned = line.replace(/^[-*•]\s+/, "");

    if (section === "highlights") highlights.push(cleaned);
    else if (section === "growth") growth.push(cleaned);
    else if (section === "challenge") {
      // Usually one line; if multiple, concatenate.
      challenge = challenge ? `${challenge} ${cleaned}` : cleaned;
    }
  }

  // Fallback: if headings weren’t detected, just treat whole thing as summary
  return {
    highlights,
    growth,
    challenge,
  };
}

async function callOpenAI({ instructions, input, model }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("Missing OPENAI_API_KEY environment variable in Vercel.");
  }

  const body = {
    model,
    instructions,
    input,
    temperature: 0,
    // store: false, // optional: set true/false depending on your org policy
  };

  const resp = await fetch(OPENAI_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const json = await resp.json();
  if (!resp.ok) {
    const msg = json?.error?.message || JSON.stringify(json);
    throw new Error(`OpenAI error (${resp.status}): ${msg}`);
  }
  return json;
}

// ---------- handler ----------
export default async function handler(req, res) {
  // Browser check
  if (req.method === "GET") {
    return res.status(200).json({
      ok: true,
      message:
        "POST JSON to this endpoint: { transcript, timing, metrics, scenario }",
    });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method Not Allowed. Use POST." });
  }

  try {
    const body = req.body || {};

    const transcript = body.transcript;
    if (!transcript || typeof transcript !== "string") {
      return res.status(400).json({
        ok: false,
        error:
          "Missing transcript. Send JSON like: { transcript: 'USER: ...\\nAGENT: ...', timing:{...}, metrics:{...}, scenario:{...} }",
      });
    }

    // Defaults (you can keep these simple while you’re getting started)
    const timing = body.timing || { maxSeconds: 420, actualSeconds: null };
    const metrics = body.metrics || {
      wpm: null,
      fillerRatePct: null,
      questionCount: null,
      interruptions: null,
    };
    const scenario = body.scenario || {
      name: "Mark — Initial Buyer Contact",
      tags: ["buyer", "first-time", "financing", "education"],
      requiredInfo: ["timeline", "budget comfort", "motivation"],
      forbiddenPhrases: ["guaranteed", "promise", "certainly will"],
      idealCTA: "Schedule a buyer consult and lender pre-approval intro.",
    };

    const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

    // 1) SCORING ENGINE (returns JSON only)
    const scoringPayload = {
      transcript,
      timing,
      metrics,
      scenario,
    };

    const scoringResponse = await callOpenAI({
      instructions: SCORING_ENGINE_SYSTEM_PROMPT,
      input: JSON.stringify(scoringPayload),
      model,
    });

    const scoringText = extractOutputText(scoringResponse);
    const scoringJson = safeJsonParse(scoringText);

    // 2) FEEDBACK ENGINE (returns plain text)
    const feedbackPayload = {
      session: scoringPayload,
      scoring: scoringJson,
    };

    const feedbackResponse = await callOpenAI({
      instructions: FEEDBACK_ENGINE_SYSTEM_PROMPT,
      input: JSON.stringify(feedbackPayload),
      model,
    });

    const feedbackText = extractOutputText(feedbackResponse);

    // 3) Build narrator-ready fields (simple mapping)
    const sections = parseFeedbackSections(feedbackText);

    // Minimal narrator variables (you can rename to match ElevenLabs dynamic variables)
    const narratorVars = {
      DISPLAYED_SCORE: scoringJson.displayedScore,
      BAND: scoringJson.band,
      OPTIONAL_PERSONAL_BEST_LINE: scoringJson.personalBest
        ? "Personal best achieved."
        : "",
      OPTIONAL_BADGE_LINE:
        Array.isArray(scoringJson.badgesAwarded) && scoringJson.badgesAwarded.length
          ? `Badge unlocked: ${scoringJson.badgesAwarded[0].name}`
          : "",
      EVALUATION_SUMMARY:
        sections.highlights.length
          ? sections.highlights.slice(0, 2).join(" ")
          : "Solid work. Keep building consistency rep to rep.",
      EVALUATION_STRENGTHS:
        sections.highlights.length ? sections.highlights.join(" ") : "",
      EVALUATION_IMPROVEMENTS:
        sections.growth.length ? sections.growth.join(" ") : "",
      EVALUATION_NEXT_STEP: sections.challenge || "",
    };

    return res.status(200).json({
      ok: true,
      scoring: scoringJson,
      feedbackText,
      narratorVars,
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err?.message || String(err),
    });
  }
}
