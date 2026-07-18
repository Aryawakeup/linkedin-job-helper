chrome.runtime.onMessage.addListener(msg => {
  if (msg && msg.type === "open-options") {
    chrome.runtime.openOptionsPage();
  }
});
