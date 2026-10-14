# Wangechi Realty

An English-language Kenyan property website with a prepared shared agent admin. The public website is **https://wangechirealty.com/**; the agent entry is **https://wangechirealty.com/admin/**.

The Supabase connection is currently empty. The public website continues to use `public/site-config.json`, with eight explicitly labelled sample listings. Approved-account login, shared drafts, photo uploads and direct publication become available after the business creates and connects its own Supabase project. Follow [the complete admin setup](docs/admin-setup.md).

## Shared agent workflow

After the one-time backend setup:

1. Open **Agent login** in the footer or `/admin/` and sign in with an approved email/password account.
2. Add or edit an offer, its price, description, location and availability. Upload an authorised JPEG, PNG or WebP photograph, up to 8 MB; cover and gallery photographs are supported.
3. Save the property form, then **Save draft** to keep the shared catalogue for the next session or another approved device. Visitors continue to see the published version.
4. **Preview on this device** shows the draft locally. **Publish website** makes the validated catalogue available to visitors immediately, without editing GitHub or rebuilding the website.

An account must be explicitly approved in the database. Signing in alone does not grant administration rights. Drafts and photo writes are protected by database row-level policies, and stale revisions are rejected to prevent one device overwriting another device's newer changes. Public configuration exports contain only business details and offers.

Uploads are public marketing images immediately, including photos uploaded for a draft. The app does not overwrite or delete stored photos. Removing an image from a listing only changes the listing; check published references before removing files in the provider's dashboard.

## Public catalogue and enquiries

The catalogue supports buy/rent, location, type and budget filters, saved shortlists and available/reserved/sold/let statuses. Sold or let offers are hidden by default and cannot request a viewing. Real listings require acknowledgement of photo publishing rights; sample prices and photographs remain clearly labelled.

Viewing and owner enquiries prepare WhatsApp messages or email drafts for **+254142406452** and **wangechirealty@gmail.com**. Visitors send them in their chosen provider. The website does not automatically send messages or confirm appointments.

The transport planning estimate is KSh 1,000 for an Uber round trip. A fixed viewing charge remains disabled. The existing optional fee policy is disclosed and accepted before a fixed-cost request; the website collects no payments. Confirm applicable Kenyan remuneration rules and commercial terms before introducing a binding charge.

## Existing local workspace and backups

While the backend is unconfigured, the agent entry offers **Open local workspace**. This retains the original device-local editor and manual publication workflow: export the public website file, replace `public/site-config.json` in GitHub and commit to `main`.

When connected, approved agents can use the local workspace for existing device backups. Old browser keys `makao-broker-public-draft-v1` and `makao-broker-private-enquiries-v1` are preserved. Local drafts and the manual client tracker are not automatically uploaded or shared. Private client notes, costs and commissions must remain outside public exports and the public repository. Another person using the same browser profile can access device-local data; retain private backups on a protected device.

When cloud mode is connected, visitors read the published database snapshot. Editing the old static JSON no longer changes live listings. A cloud error shows an unavailable collection instead of silently displaying outdated static offers.

## Development and verification

Use the existing checkout at `/workspace/webseite`; cloud tasks are already isolated, so do not create another Git worktree unless requested. Requires Node.js 22 or newer; Node.js 24 is used in CI.

```bash
cd /workspace/webseite
npm ci
npm test
npm run dev -- --port 5173 --strictPort
```

The test suite includes actual PostgreSQL execution through PGlite for the schema, row-level policies, publication transactions, stale revision rejection and storage permissions. Supabase auth/storage schema fixtures model the required interfaces. Service transport tests and browser mocks exercise the prepared client. Hosted account login, API and real storage checks still need the business-owned project.

```bash
npm run build
npm run preview -- --port 4173 --strictPort
```

Local development uses `/`. To test the original GitHub project path:

```bash
GITHUB_PAGES=true PAGES_BASE_PATH=/webseite/ npm run build
GITHUB_PAGES=true PAGES_BASE_PATH=/webseite/ npm run preview -- --port 4173 --strictPort
```

For the connected domain root, use `PAGES_BASE_PATH=/` instead. The deployment workflow reads the actual path from `actions/configure-pages` and publishes pushes to `main`. The `/admin/` static entry redirects to the same website's `#admin` route under either base.

`public/admin-config.json` contains only a project URL and a public Supabase publishable key (or legacy anon key). Never place a service-role/secret key, database password, account password or private client backup in frontend files. Empty connection values deliberately leave cloud administration inactive. No server credential is needed to develop or run local checks.

See [IMAGE_SOURCES.md](IMAGE_SOURCES.md) for the illustrative photographs, and [docs/admin-setup.md](docs/admin-setup.md) for provider setup, initial activation, backups and account recovery.
