let input = "";

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  input += chunk;
});
process.stdin.on("end", () => {
  const request = JSON.parse(input);

  if (request.prompt === "timeout") {
    setTimeout(() => {}, 10_000);
    return;
  }

  if (request.prompt === "fail") {
    process.stderr.write("synthetic sidecar failure");
    process.exitCode = 7;
    return;
  }

  if (request.prompt === "malformed") {
    process.stdout.write("not-json");
    return;
  }

  if (request.prompt === "oversized") {
    process.stdout.write(JSON.stringify({ padding: "x".repeat(10_000) }));
    return;
  }

  if (request.prompt === "missing token") {
    process.stdout.write(JSON.stringify({
      ok: false,
      error: { code: "missing_hf_token", message: "HF_TOKEN is required." },
    }));
    return;
  }

  process.stdout.write(JSON.stringify({
    ok: true,
    seed: request.seed,
    bricks: [{ width: 2, depth: 4, x: 1, y: 2, z: 0 }],
    metadata: { prompt: request.prompt, rejections: 0, regenerations: 0 },
  }));
});
