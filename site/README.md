# Site

The project's web page. "Run the demo" plays the hub's recorded story in the browser, with no server.

## Run it

```sh
cd site
npm install
npm run demo
npm run dev
```

1. `npm run demo` builds the hub's page into `public/demo/` (it needs `hub/` installed: `cd hub && npm install`).
2. `npm run dev` opens the site on port 5174.
3. For a finished site in `dist/`: `npm run build:all`.

## Folders

- `src/`: the page (React)
- `public/`: images and the copied demo
- `scripts/demo.mjs`: builds the hub page into `public/demo/`
- `dist/`: the built site

## What is real and what is simulated

- The demo is a recording of one night. Nothing in it is live.
