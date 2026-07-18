const resumeEl = document.getElementById("resume");
const keywordsEl = document.getElementById("keywords");
const statusEl = document.getElementById("status");

chrome.storage.local.get(["resumeText", "extraKeywords"], data => {
  resumeEl.value = data.resumeText || "";
  keywordsEl.value = data.extraKeywords || "";
});

document.getElementById("save").addEventListener("click", () => {
  chrome.storage.local.set(
    { resumeText: resumeEl.value, extraKeywords: keywordsEl.value },
    () => {
      statusEl.textContent = "已保存 ✓";
      setTimeout(() => (statusEl.textContent = ""), 2000);
    }
  );
});
