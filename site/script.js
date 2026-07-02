// Copy-to-clipboard buttons
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
      // Clipboard unavailable (e.g. insecure context); nothing sensible to do.
    }
  });
}

// Hairline under the header once the page scrolls
const header = document.querySelector(".site-header");
if (header) {
  const update = () => header.classList.toggle("scrolled", window.scrollY > 8);
  update();
  window.addEventListener("scroll", update, { passive: true });
}
