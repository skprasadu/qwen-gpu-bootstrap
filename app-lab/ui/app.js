const $ = (id) => document.getElementById(id);
const escape = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const names = { list: "Simple List", kanban: "Kanban", focus: "Daily Focus" };
let capacityConfigured = false;
async function api(path, body) {
  const response = await fetch(
    path,
    body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  const data = await response.json();
  if (!response.ok) throw Error(data.error);
  return data;
}
function error(e) {
  $("error").hidden = false;
  $("error").textContent = e.message;
}
async function refresh() {
  const { runs, maximumConcurrency } = await api("/api/runs");
  $("concurrency").options[1].disabled = maximumConcurrency < 2;
  if (!capacityConfigured) {
    $("concurrency").value = String(maximumConcurrency);
    capacityConfigured = true;
  }
  if (maximumConcurrency < 2) $("concurrency").value = "1";
  $("capacity").textContent =
    maximumConcurrency === 2
      ? "Two-request serving qualified. Each run has a 60-minute deadline."
      : "Sequential serving available. Qualify two-request capacity on the GPU to enable concurrent workers.";
  $("start").disabled = runs.some(
    (r) => r.state === "running" || r.jobs.some((j) => j.preview),
  );
  $("runs").innerHTML = runs
    .map(
      (run) =>
        `<article class="run"><div class="run-heading"><div><h2>${escape(run.state)} · ${Math.round(((run.finishedAt ?? Date.now()) - run.createdAt) / 1000)} seconds</h2><small>${escape(run.id)} · ${run.concurrency} worker(s) · ${escape(run.source)}</small></div><button data-stop="${escape(run.id)}">Stop run / previews</button></div>${run.error ? `<p>${escape(run.error)}</p>` : ""}<div class="cards">${run.jobs.map((job) => `<section class="card"><span class="badge ${escape(job.status)}">${escape(job.status)}</span><h3>${names[job.variant]}</h3><p>${job.attempts} generation attempt(s) · ${job.history.at(-1)?.passedTests ?? 0}/4 required acceptance cases passed</p>${job.preview ? `<a class="preview" target="_blank" rel="noopener" href="http://${location.hostname}:${Number(job.preview)}">Open preview ↗</a>` : '<p class="muted">Preview available after verification.</p>'}<div class="evidence">${job.attempts ? `<a target="_blank" href="/api/evidence/${run.id}/${job.variant}/worker-${job.attempts}.log">Worker log</a>` : ""}${job.history.map((_, i) => `<a target="_blank" href="/api/evidence/${run.id}/${job.variant}/evidence-${i + 1}/result.json">Attempt ${i + 1} evidence</a>`).join("")}</div>${job.error ? `<details><summary>What needs attention</summary><pre class="details">${escape(job.error)}</pre></details>` : ""}</section>`).join("")}</div></article>`,
    )
    .join("");
  for (const button of document.querySelectorAll("[data-stop]"))
    button.onclick = async () => {
      try {
        await api(`/api/runs/${button.dataset.stop}/stop`, {});
        await refresh();
      } catch (e) {
        error(e);
      }
    };
}
$("brief-form").onsubmit = async (e) => {
  e.preventDefault();
  $("error").hidden = true;
  $("start").disabled = true;
  try {
    await api("/api/runs", {
      brief: $("brief").value,
      concurrency: Number($("concurrency").value),
    });
    await refresh();
  } catch (e) {
    error(e);
    $("start").disabled = false;
  }
};
refresh().catch(error);
setInterval(() => refresh().catch(error), 3000);
