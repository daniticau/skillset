# skillset site

Static launch page for `skillset`.

Open `index.html` directly in a browser, or deploy the contents of this directory as a static site.

The social preview image comes from `assets/skillset-preview.html`:

```sh
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=old --disable-gpu --hide-scrollbars --user-data-dir=/tmp/chrome-skillset-preview --window-size=1200,630 --screenshot=site/assets/skillset-preview.png file://"$PWD/site/assets/skillset-preview.html"
```

The app screenshot in `assets/skillset-app.png` comes from the snapshot hook in `desktop/Sources/SkillsetApp/DebugSnapshot.swift`, run against a demo store (set `HOME` to a scratch folder, `sks init` there, add a few skills, then snapshot in dark appearance).

The PNG favicon comes from the SVG:

```sh
qlmanage -t -s 64 -o /tmp site/assets/skillset-icon.svg && mv /tmp/skillset-icon.svg.png site/assets/skillset-icon-64.png
```
