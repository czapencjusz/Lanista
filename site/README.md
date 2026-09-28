# Download page

`site/index.html` is the public page for GBot: what it does, how to install it, and the download
links for both browsers.

## Build

```sh
npm run site
```

This builds the extension zips and puts everything the page needs into `dist/site/`:

```
dist/site/index.html        the page, with the version, build and file sizes filled in
dist/site/downloads/        gbot-chrome.zip and gbot-firefox.zip
dist/site/img/              screenshots (from docs/) and the icon
dist/site/fonts/            Marcellus and Alegreya Sans (SIL Open Font License)
```

It also writes `dist/gbot-site.zip`, the same files in one archive.

The page loads nothing from other websites: no web fonts service, no analytics.

## Publish

Upload the contents of `dist/site/` to any static host. For example:

* **Netlify:** drag the `dist/site` folder onto <https://app.netlify.com/drop>.
* **Cloudflare Pages:** create a project with *Direct Upload* and upload `dist/gbot-site.zip`.
* **GitHub Pages:** works once the repository is public (or on a paid plan): publish the contents of
  `dist/site/` from a `gh-pages` branch.
* **Any web server:** copy the files into a folder it serves.

To release a new build, run `npm run site` again and upload the new files. The page shows the
version from `manifest.json` and the commit it was built from.
