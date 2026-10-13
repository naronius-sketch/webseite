# Wangechi Realty

An English-language property website and local agent workspace for Wangechi Realty in Kenya. Public contact details are configured in `public/site-config.json`:

- WhatsApp/telephone: +254142406452
- Email: wangechirealty@gmail.com
- Public website: https://naronius-sketch.github.io/webseite/

The initial eight properties are clearly marked sample listings. Replace them with authorised real offers and photographs before presenting them as available properties.

## What works

- Buy/rent, location, type and budget filters; saved shortlists.
- Available, reserved, sold and let statuses. Sold/let offers are hidden by default and cannot request a viewing.
- Viewing enquiries with budget, preferred date/time and Kenya time zone.
- Prepared WhatsApp messages, telephone links and email drafts to the actual business contacts. The visitor sends the message in their chosen provider; opening a draft does not send it or confirm an appointment.
- Owner enquiries for selling or letting a property.
- An agent workspace to edit listings and public business settings, preview a draft, and export the public website file.
- A separate private local enquiry tracker with follow-up stages, completed viewings, actual transport costs and received commissions.

## How the agent updates listings

1. Open **Agent workspace** at the bottom of the website.
2. Add or edit an offer in **Listings**. Provide a description, status and a photograph URL. Mark sample listings honestly and confirm permission for photographs used with real listings.
3. **Save local draft** keeps the work on this device; **Preview on this device** shows the draft without changing the published site.
4. **Download public website file** exports `site-config.json` containing only public business details and listings.
5. Open the workspace's GitHub editing link, replace the contents of `public/site-config.json` with the downloaded JSON and commit to `main`. The existing GitHub Actions workflow builds and deploys the update.

For owned photos, upload files to the repository's `public/images/` directory and enter `/images/filename.jpg` as the photo address. Public HTTPS image URLs are also accepted. Photos, prices and addresses must be checked by the agent; a checkbox is an acknowledgement, not independent verification.

## Workspace and private enquiries

GitHub Pages hosts static files. The workspace is a local editor, not an authenticated server administration panel. It has no shared database and no automatic incoming enquiries inbox.

Public drafts are stored in the browser under `makao-broker-public-draft-v1`. Enquiries entered manually by the agent are stored separately under `makao-broker-private-enquiries-v1`. Another device does not receive them. Anyone using the same browser profile can open this workspace. Use a private, protected device and retain private backups.

Public export excludes enquiry names, contact details, notes and financial records. **Private backup** exports a separate JSON file: never upload it to the public repository. A backend with authentication is needed for a shared office inbox, secure multi-device accounts and automatic server-side enquiry storage.

## Transport contributions

The supplied planning estimate is KSh 1,000 for an Uber round trip. A fixed charge is **not enabled**. Visitors request an appointment and the agent agrees any transport contribution before confirming it. The site collects no payments and does not integrate M-Pesa.

Business settings can prepare a quoted or fixed contribution. An enabled fixed amount is disclosed before a request, requires explicit acceptance and explains the selected credit/cancellation terms. Enabling and publishing a policy is the agent's deliberate decision. Confirm applicable Kenyan remuneration rules and the agreed commercial terms before introducing a binding charge; current legal permission or a statutory fee amount has not been established by this project.

## Development

Use the existing checkout at `/workspace/webseite`; cloud tasks are already isolated, so do not create an additional Git worktree unless requested.

```bash
cd /workspace/webseite
npm ci
npm test
npm run dev -- --port 5173 --strictPort
```

Requires Node.js 22 or newer; validated with Node.js 24.19.0 and npm 11.9.0. No server credentials or database are required for this static workflow. Never put GitHub tokens, backend service keys or private enquiry records in public JSON or frontend source.

```bash
npm run build
npm run preview -- --port 4173 --strictPort
```

The normal base path is `/`. For GitHub Pages:

```bash
GITHUB_PAGES=true npm run build
GITHUB_PAGES=true npm run preview -- --port 4173 --strictPort
```

The Pages base path is `/webseite/`. CSS, scripts, favicon, catalogue, fonts and images use that prefix. The workflow `.github/workflows/deploy-pages.yml` publishes commits pushed to `main` or a manual workflow dispatch.

See `IMAGE_SOURCES.md` for the illustrative photographs used in sample listings.
