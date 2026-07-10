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
];

async function loadJobs() {
  const res = await fetch("/api/jobs");
  const jobs = await res.json();

  if (!Array.isArray(jobs) || jobs.length === 0) {
    jobsList.innerHTML = '<li class="empty">No job demands yet.</li>';
    return;
  }

  jobsList.innerHTML = "";
  for (const job of jobs) {
    const li = document.createElement("li");
    li.className = "job-card";
    li.innerHTML = `
      <div>
        <div class="title">${job.role} — ${job.client_name}</div>
        <div class="meta">${job.category} · ${job.salary || "no salary set"} · ${job.contract_length || "no contract length set"}</div>
      </div>
      <div class="job-actions" style="display:flex; align-items:center; gap:8px;">
        <span class="status">${job.status}</span>
        <button data-id="${job.id}" class="generate-btn">Generate Script</button>
      </div>
    `;
    jobsList.appendChild(li);
  }

  document.querySelectorAll(".generate-btn").forEach((btn) => {
    btn.addEventListener("click", () => generateScript(btn.dataset.id, btn));
  });
}

async function generateScript(id, btn) {
  btn.disabled = true;
  btn.textContent = "Generating...";
  try {
    const res = await fetch(`/api/jobs/${id}/generate-script`, { method: "POST" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to generate script");

    scriptSection.hidden = false;
    scriptOutput.textContent = JSON.stringify(data.script, null, 2);
    scriptSection.scrollIntoView({ behavior: "smooth" });
    await loadJobs();
  } catch (err) {
    alert(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Generate Script";
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
