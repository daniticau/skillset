// Copy-to-clipboard buttons next to the install command.
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

// Hairline under the header once the page scrolls.
const header = document.querySelector(".site-header");
if (header) {
  const update = () => header.classList.toggle("scrolled", window.scrollY > 8);
  update();
  window.addEventListener("scroll", update, { passive: true });
}

// In-page links scroll without writing a #fragment into the address bar, so
// the URL stays skillset.daniticau.com. The hrefs still work without script.
for (const link of document.querySelectorAll('a[href^="#"]')) {
  link.addEventListener("click", (event) => {
    const id = link.getAttribute("href").slice(1);
    const target = id === "top" ? document.body : document.getElementById(id);
    if (!target) return;
    event.preventDefault();
    if (id === "top") window.scrollTo({ top: 0 });
    else target.scrollIntoView();
  });
}

// A shared link with a fragment still lands on its section, then drops the fragment.
if (location.hash) {
  const target = document.getElementById(decodeURIComponent(location.hash.slice(1)));
  history.replaceState(null, "", location.pathname + location.search);
  target?.scrollIntoView({ behavior: "instant" });
}
