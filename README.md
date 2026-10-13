# Makao — Kenya property website

A responsive, English-language property website built with React and Vite. Includes eight illustrative listings across Nairobi, Mombasa, Kilifi and Kisumu, with prices in Kenyan shillings.

## Run locally

Use the existing checkout at `/workspace/webseite`; cloud tasks are already isolated and do not need an additional Git worktree.

```bash
cd /workspace/webseite
npm ci
npm run dev -- --port 5173 --strictPort
```

Requires Node.js 22 or newer (validated with Node.js 24.19.0 and npm 11.9.0). The development server listens on all interfaces. No credentials, environment variables or database are required.

```bash
npm run build
npm run preview -- --port 4173 --strictPort
```

The production output is in `dist/` and can be deployed to a static hosting service.

## GitHub Pages

The deployment workflow is `.github/workflows/deploy-pages.yml`. It builds and publishes changes pushed to `main`, or can be started manually from GitHub Actions. No extra repository secret is needed for the workflow.

The repository owner must first enable **Settings → Pages → Build and deployment → Source → GitHub Actions**. GitHub's standard workflow token cannot activate a new Pages site itself. After enabling Pages, run the **Deploy Makao to GitHub Pages** workflow from the Actions tab if the initial workflow ran before Pages was enabled.

The default project URL after a successful deployment is `https://naronius-sketch.github.io/webseite/`. A private repository may require a GitHub plan that supports Pages; this setup does not change the repository's visibility.

To validate the Pages build locally:

```bash
GITHUB_PAGES=true npm run build
GITHUB_PAGES=true npm run preview -- --port 4173 --strictPort
```

The Pages build uses the `/webseite/` base path. Normal development and builds retain `/`. Images, styles, scripts and the favicon respect the Pages base path.

## Features

- Filter by purchase/rental, location, property type and maximum budget.
- Browse property details and amenities.
- Save a property shortlist in this browser and return to it later.
- Prepare and download a viewing enquiry.
- Create and download a property listing draft.
- Responsive navigation, location browsing and keyboard-accessible dialogs.

## Content and enquiries

The current properties are demo data, not real listings. Edit `src/data.js` to supply authorised listings and replace the photographs with images you may use commercially. See `IMAGE_SOURCES.md` for the current image sources. Photographs illustrate architectural styles and do not establish the location or condition of a property.

Enquiries and listing drafts are saved on the visitor's device and downloaded as JSON. They are not sent to an agent, published, or stored on a server. A production business would need a real listings source, a contact destination or backend, its own branding and contact details, and an appropriate privacy policy before collecting enquiries remotely.

Fonts, icons and photos are served locally; the website does not require third-party requests to render.
