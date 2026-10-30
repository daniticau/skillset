// Copy-to-clipboard button next to the install command.
for (const button of document.querySelectorAll("[data-copy-target]")) {
  button.addEventListener("click", async () => {
    const target = document.getElementById(button.getAttribute("data-copy-target"));
    const value = target?.textContent?.trim();
    if (!value) return;

    try {
      await navigator.clipboard.writeText(value);
      button.classList.add("copied");
      window.setTimeout(() => button.classList.remove("copied"), 1600);
    } catch {
      // Clipboard unavailable (for example an insecure context). Nothing sensible to do.
    }
  });
}

// Old links may carry a #fragment from the longer page. Drop it so the
// address bar stays skillset.daniticau.com.
if (location.hash) {
  history.replaceState(null, "", location.pathname + location.search);
}
