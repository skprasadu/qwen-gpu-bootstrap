export function summarizeRequests(text: string | null, run: string) {
  const unavailable = {
    requests: null,
    overlappingRequests: null,
    tokens: null,
  };
  if (text === null) return unavailable;
  let requests: any[] = [];
  try {
    const events = text.trim()
      ? text
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line))
      : [];
    if (
      events.some(
        (event) =>
          !event ||
          typeof event.run !== "string" ||
          typeof event.route !== "string",
      )
    )
      return unavailable;
    requests = events.filter(
      (request) =>
        request.run === run && request.route === "v1/chat/completions",
    );
  } catch {
    return unavailable;
  }
  const tokensAvailable =
    requests.length > 0 &&
    requests.every(
      (request) =>
        Number.isFinite(request.usage?.total_tokens) &&
        request.usage.total_tokens >= 0,
    );
  const overlapAvailable = requests.every(
    (request) =>
      Number.isInteger(request.activeAtStart) && request.activeAtStart >= 1,
  );
  return {
    requests: requests.length,
    overlappingRequests: overlapAvailable
      ? requests.some((request) => request.activeAtStart >= 2)
      : null,
    tokens: tokensAvailable
      ? requests.reduce((sum, request) => sum + request.usage.total_tokens, 0)
      : null,
  };
}
