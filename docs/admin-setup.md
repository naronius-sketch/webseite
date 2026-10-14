# Set up the shared Wangechi Realty admin

The prepared admin opens at **https://wangechirealty.com/admin/**. It supports approved email/password accounts, a shared listing draft, photo uploads and direct publication. A Supabase project must be connected before cloud sign-in works. Empty `public/admin-config.json` settings keep the existing static catalogue and local workspace available.

This setup changes the public listing catalogue. Customer enquiries, private notes, transport expenses and commissions in the existing local tracker are **not** uploaded or shared. Visitors still send viewing and owner enquiries through their chosen WhatsApp or email service.

## 1. Create a project owned by the business

1. Sign in at [Supabase](https://supabase.com/dashboard) and create a project in an organisation controlled by the business owner. You can start with the Free plan; check the provider's current quotas, backup features and inactivity rules before depending on it for daily business.
2. Give it a clear name, such as **Wangechi Realty**. Choose a suitable region and create a strong database password. Store this password privately; it is not a website setting.
3. Wait for the project to finish provisioning. Keep the Supabase owner account accessible for support and account recovery, and enable account protection available in the dashboard.

Nothing in the website creates a project or purchases a plan automatically.

## 2. Install the database and photo policies

In the project's **SQL Editor**, open a new query, copy the complete contents of [supabase/schema.sql](../supabase/schema.sql), and run it. Then run [supabase/seed.sql](../supabase/seed.sql) in a second query.

Supabase already manages row-level security and table grants for `storage.objects`. The schema adds the application's Storage policies through the [supported SQL-editor policy permissions](https://github.com/supabase/supautils#manage-policies); it does not alter that provider-owned table or change its owner. If an older copy failed with `must be owner of table objects`, start a new query and run the complete current file. The script uses one transaction, so the failed installation must not be resumed from its last line. A previous aborted transaction may need `ROLLBACK;` before retrying.

The schema creates:

- `public.site_admins`: the approved account IDs. Website accounts cannot add themselves.
- `public.site_catalogues`: separate shared draft and published catalogues, with revision checks to protect against one device overwriting another device's newer work.
- Restricted functions for loading, saving and publishing the catalogue. Ordinary signed-in accounts have no administration rights.
- The `property-photos` public storage bucket, limited to JPEG, PNG and WebP files of up to 8 MB. Approved administrators can add new files under their own account folder; the app cannot overwrite or delete already uploaded files.

The seed starts with the eight clearly labelled sample listings already present on the website. Replace them with authorised real offers before advertising available properties. Running the setup and seed again does not reset an already edited catalogue. Preserve the SQL output and resolve any error before continuing.

Database row-level security protects drafts and administration. **Uploaded photos are public immediately, even while a listing is still a draft.** Upload only property photos intended for public marketing. Do not upload identity documents, contracts, customer information or other confidential files. Removing a photo from a listing does not delete the stored file; an owner can manage unused files in the Supabase dashboard after checking that no published offer uses them.

## 3. Create and approve the agent's account

1. Open **Authentication → Users**. Choose **Add user → Create new user** rather than sending an invitation. Create the intended agent account, for example `wangechirealty@gmail.com`, with a strong password agreed privately with the agent. Select **Auto Confirm User** for this manually verified account. Do not post the password in GitHub or this chat.
2. Copy the new account's **User UID**, which looks like a UUID. An email address alone does not grant access.
3. In SQL Editor, replace the example UUID below with that exact User UID and run:

```sql
insert into public.site_admins (user_id)
values ('REPLACE-WITH-THE-USER-UID'::uuid)
on conflict (user_id) do nothing;
```

Under the authentication settings, keep email/password sign-in enabled, turn **Allow new users to sign up** off, and keep anonymous sign-ins off. The website has no public registration form. Even if signup is later enabled, an account still needs explicit membership in `site_admins`.

Under **Authentication → URL Configuration**, set **Site URL** to `https://wangechirealty.com`. Use exact HTTPS addresses such as `https://wangechirealty.com/admin/` in the redirect allowlist when needed. Password sign-in in this admin does not require an email redirect. Add `http://localhost:5173` only if you need local development authentication; do not use a broad wildcard.

## 4. Connect the public website

Find the project's **Project URL** and **publishable key** in the dashboard's API connection/key settings. The URL has the form `https://YOUR-PROJECT-REF.supabase.co`; the modern public key starts with `sb_publishable_`. A legacy key labelled **anon / public** is also supported.

Edit [public/admin-config.json](../public/admin-config.json) in the GitHub repository and fill in:

```json
{
  "schemaVersion": 1,
  "supabaseUrl": "https://YOUR-PROJECT-REF.supabase.co",
  "publishableKey": "sb_publishable_REPLACE_WITH_YOUR_PUBLIC_KEY"
}
```

These two values are deliberately public: browsers need them to reach the service, and SQL policies determine what each caller can do. **Never use a secret key, a `service_role` key, the database password, an agent password or an access token in this file.** The website rejects secret/service-role keys, but that does not make publishing one safe.

Commit the file to `main` and wait for **Deploy Wangechi Realty to GitHub Pages** to finish successfully. Install the schema, seed and approved user before publishing these connection settings. Once connected, visitors read the published database catalogue; editing `public/site-config.json` no longer changes those live listings. If the connected service fails, the site does not silently substitute old static offers.

## 5. Check the first login and publication

1. Open **https://wangechirealty.com/admin/** on the agent's device and sign in with her approved account.
2. Load the shared catalogue. Edit one sample listing and save a draft. Open the website in a separate private browser window: the unpublished change must not appear there.
3. Try an authorised property photo under 8 MB. Use the rights confirmation for a real listing. The uploaded image address is saved in the listing; a file upload alone does not publish the listing.
4. Click **Publish** when the catalogue is ready. Refresh the public website: the published change should now appear without editing GitHub or waiting for another website build.
5. Sign in from a second device and confirm the shared catalogue is present. If the admin reports that another device changed it, reload the latest version before saving; do not deliberately overwrite newer work.
6. Sign out and confirm that the admin needs a login again. Use personal, protected devices and sign out on shared devices. Sign-in may persist in that browser until sign-out; private customer tracker data remains local to that browser.

These hosted checks are still required after the project is connected. Local SQL tests execute the real schema and row-level policies in PostgreSQL, but do not exercise Supabase's hosted authentication, Data API or Storage HTTP service.

## Change the agent's password

After signing in, open **Account**, enter the current password, and enter a new password twice. Choose a different password with at least 12 characters. Supabase limits new passwords to 72 UTF-8 bytes; emoji and accented letters can use more than one byte, so the form checks the encoded length before submitting. **Change password** confirms the current password with Supabase Auth before updating that same account. Property edits stay in the working draft; this action does not save or publish the catalogue. After success, use the new password the next time you sign in. Other devices may need to sign in again. Keep the password private; no password is needed in GitHub, SQL or this chat.

The provider's own password policy also applies. A rejected password or failed request shows an error instead of a success message. A connection failure during the update can leave its outcome uncertain; the new password may already apply. If Supabase asks for a fresh sign-in, save or back up any property edits, sign out, and sign in again before retrying. Check the completed change with a private browser window using the new password. Do not deliberately change the business account during automated tests.

## Backups, revocation and account recovery

Keep a downloaded public catalogue backup before major edits. A JSON export contains public business details and offers; photos remain separate storage files and need their own backup. Use the Supabase dashboard's database/storage export or backup features according to the chosen plan. Keep private tracker backups outside the public repository.

To remove someone's administration access, run this in the owner's SQL Editor using their actual User UID:

```sql
delete from public.site_admins
where user_id = 'REPLACE-WITH-THE-USER-UID'::uuid;
```

The next protected request is denied even if that user still has an otherwise valid authentication session. Membership removal does not delete the person's photos or change published offers. Also remove the Supabase Auth user when the account should no longer exist, and revoke any separate GitHub or project-owner access as appropriate.

The website supports password changes after sign-in, without an email recovery screen. If the agent forgets the current password and cannot use a provider-supported password update, the owner can create a replacement confirmed account, approve its new UID, verify login, and then remove the old UID. Follow step 3 with the replacement account; do not change authentication password fields directly with SQL. Keep a trusted project owner who can perform this recovery. Additional project owners should be added deliberately because their dashboard access is broader than the website's listing-admin role.

Official references: [API keys](https://supabase.com/docs/guides/getting-started/api-keys), [row-level security](https://supabase.com/docs/guides/database/postgres/row-level-security), [Storage access control](https://supabase.com/docs/guides/storage/security/access-control), and [Auth configuration](https://supabase.com/docs/guides/auth/general-configuration).
