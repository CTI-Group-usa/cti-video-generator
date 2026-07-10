const form = document.getElementById("job-form");
const jobsList = document.getElementById("jobs-list");
const scriptSection = document.getElementById("script-section");
const scriptOutput = document.getElementById("script-output");

const fields = [
  "category",
  "client_name",
  "role",
  "salary",
  "contract_length",
  "location",
  "benefits",
  "requirements",
  "application_deadline",
  "extra_notes",
  "aspect_ratio",
  "duration_target",
];

const IN_PROGRESS_STATUSES = new Set(["generating_assets", "rendering"]);
const pollTimers = new Map();

function actionForStatus(job) {
  switch (job.status) {
    case "draft":
      return { label: "Generate Script", action: "generate-script" };
    case "script_ready":
      return { label: "Generate Video Assets", action: "generate-assets" };
    case "assets_ready":
      return { label: "Render Video", action: "render" };
    case "ready":
      return { label: "Re-render", action: "render" };
    case "failed":
      if (job.assets_json) return { label: "Retry Render", action: "render" };
      if (job.script_json) return { label: "Retry Assets", action: "generate-assets" };
      return { label: "Retry Script", action: "generate-script" };
    default:
      return null;
  }
}

function renderJobCard(job) {
  const li = document.createElement("li");
  li.className = "job-card";

  const inProgress = IN_PROGRESS_STATUSES.has(job.status);
  const action = actionForStatus(job);

  let extra = "";
  if (job.status === "failed" && job.render_error) {
    extra = `<div class="error-text">${job.render_error}</div>`;
  }
  if (job.status === "ready" && job.video_url) {
    extra = `<video class="job-video" controls src="${job.video_url}"></video>`;
  }

  li.innerHTML = `
    <div style="flex:1;">
      <div class="title">${job.role} — ${job.client_name}</div>
      <div class="meta">${job.category} · ${job.aspect_ratio} · ${job.duration_target}s · ${job.salary || "no salary set"}</div>
      ${extra}
    </div>
    <div class="job-actions" style="display:flex; align-items:center; gap:8px;">
      <span class="status">${job.status}</span>
      ${
        inProgress
          ? `<button disabled>Working…</button>`
          : action
            ? `<button data-id="${job.id}" data-action="${action.action}" class="action-btn">${action.label}</button>`
            : ""
      }
    </div>
  `;
  return li;
}

async function loadJobs() {
  const res = await fetch("/api/jobs");
  const jobs = await res.json();

  if (!Array.isArray(jobs) || jobs.length === 0) {
    jobsList.innerHTML = '<li class="empty">No job demands yet.</li>';
    return;
  }

  jobsList.innerHTML = "";
  for (const job of jobs) {
    jobsList.appendChild(renderJobCard(job));
    if (IN_PROGRESS_STATUSES.has(job.status)) {
      pollJob(job.id);
    }
  }

  document.querySelectorAll(".action-btn").forEach((btn) => {
    btn.addEventListener("click", () => runAction(btn.dataset.id, btn.dataset.action, btn));
  });
}

function pollJob(id) {
  if (pollTimers.has(id)) return;
  const timer = setInterval(async () => {
    const res = await fetch(`/api/jobs/${id}`);
    const job = await res.json();
    if (!IN_PROGRESS_STATUSES.has(job.status)) {
      clearInterval(pollTimers.get(id));
      pollTimers.delete(id);
      await loadJobs();
    }
  }, 4000);
  pollTimers.set(id, timer);
}

async function runAction(id, action, btn) {
  btn.disabled = true;
  btn.textContent = "Working…";
  try {
    const res = await fetch(`/api/jobs/${id}/${action}`, { method: "POST" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Failed to ${action}`);

    if (action === "generate-script" && data.script) {
      scriptSection.hidden = false;
      scriptOutput.textContent = JSON.stringify(data.script, null, 2);
      scriptSection.scrollIntoView({ behavior: "smooth" });
    }

    await loadJobs();
  } catch (err) {
    alert(err.message);
    await loadJobs();
  }
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const body = {};
  for (const field of fields) {
    body[field] = document.getElementById(field).value.trim();
  }

  const submitBtn = form.querySelector("button[type=submit]");
  submitBtn.disabled = true;

  try {
    const res = await fetch("/api/jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to save job demand");

    form.reset();
    await loadJobs();
  } catch (err) {
    alert(err.message);
  } finally {
    submitBtn.disabled = false;
  }
});

loadJobs();
