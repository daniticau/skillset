# skillset site

Static launch page for `skillset`.

Open `index.html` directly in a browser, or deploy the contents of this directory as a static site.

The hero product image is generated from `assets/skillset-preview.html`:

```sh
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless --disable-gpu --hide-scrollbars --user-data-dir=/tmp/chrome-skillset-preview --window-size=1200,760 --screenshot=site/assets/skillset-preview.png file://"$PWD/site/assets/skillset-preview.html"
```
