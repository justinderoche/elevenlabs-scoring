export default async function handler(req, res) {
  // Step 1: Get transcript from ElevenLabs
  const transcript = req.body.transcript || "";

  // Step 2: Run Scoring Engine
  const scoringResponse = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "gpt-4.1",
      messages: [
        { role: "system", content: "SCORING ENGINE SYSTEM PROMPT GOES HERE" },
        { role: "user", content: transcript }
      ]
    })
  });

  const scoring = await scoringResponse.json();

  // Step 3: Run Feedback Engine
  const feedbackResponse = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "gpt-4.1",
      messages: [
        { role: "system", content: "FEEDBACK ENGINE SYSTEM PROMPT GOES HERE" },
        { role: "user", content: JSON.stringify(scoring) }
      ]
    })
  });

  const feedback = await feedbackResponse.json();

  // Step 4: Send results back
  res.status(200).json({
    scoring,
    feedback
  });
}
