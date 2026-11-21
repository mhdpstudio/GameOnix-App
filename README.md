# GameOnix Desktop

GameOnix packaged as a Windows desktop app with integrated torrent downloads.

## Run locally

```powershell
npm install
npm run dev
```

`npm start` is an alias for the local Electron + Vite development app.

## Build the portable Windows app

```powershell
npm install
npm run dist
```

The unpacked app is written to `release/win-unpacked/`. Run `GameOnix.exe` from that folder. No installer is required. Downloads are saved under the user's Downloads folder in `GameOnix` by default. The Downloads page can pause, resume, remove, and open completed downloads, and it remembers unfinished torrents between app launches.

## GitHub releases and environment

Pushing to `main` runs `.github/workflows/publish-portable.yml`. GitHub Actions builds the contents of `release/win-unpacked/` and publishes them as `GameOnix-win-unpacked.zip` on a GitHub Release. The app checks that public release feed automatically, verifies the archive's SHA-256 digest, downloads it while open, replaces its portable files after closing, and restarts.

The workflow uses GitHub's built-in `GITHUB_TOKEN`; do not put a GitHub token in `.env`, the app bundle, or a `VITE_` variable. In the repository's **Settings → Actions → General**, allow workflows to create releases (read/write repository contents). Any `VITE_` variable is included in client code and must be treated as public.

The displayed download speed and remaining time use a short rolling average. Torrent speeds still depend on the user's connection and available peers.
