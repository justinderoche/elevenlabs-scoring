export default async function handler(req, res) {
  // 1) Allow browser GET checks without crashing
  if (req.method === "GET") {
    return res.status(200).json({
      ok: true,
      message: "This endpoint expects POST with JSON. Example: { transcript: '...', timing: {...}, metrics: {...}, scenario: {...} }"
    });
  }

  // 2) Only accept POST
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method Not Allowed. Use POST." });
  }

  // 3) Safely read JSON body
  const body = req.body || {};
  const transcript = body.transcript;

  if (!transcript || typeof transcript !== "string") {
    return res.status(400).json({
      ok: false,
      error: "Missing transcript. Send JSON like: { transcript: 'USER: ...\\nAGENT: ...' }"
    });
  }

  // 4) Temporary: just echo back what we received (proves pipeline works)
  // We'll add scoring + feedback after this passes.
  return res.status(200).json({
    ok: true,
    receivedChars: transcript.length
  });
}
