# CanaryGrid manual setup

CanaryGrid runs locally without paid services. A real GitHub installation and a
hosted Supabase project require account-owner actions that cannot be automated
from the repository.

## Hosted Supabase

1. Create a Supabase project or open the project you want CanaryGrid to use.
2. Install the Supabase CLI and sign in with `supabase login`.
3. Link this repository:

   ```sh
   supabase link --project-ref YOUR_PROJECT_REF
   supabase db push
   ```

4. Configure the frontend with the hosted project URL and publishable key:

   ```text
   VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
   VITE_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY
   ```

5. Generate a credential-encryption key. Keep the output private:

   ```sh
   openssl rand -base64 32
   ```

6. Configure the server-only values:

   ```sh
   supabase secrets set \
     CREDENTIAL_ENCRYPTION_KEY="YOUR_GENERATED_KEY" \
     PUBLIC_APP_URL="https://YOUR_APP_DOMAIN" \
     PUBLIC_APP_URLS="https://YOUR_APP_DOMAIN"
   ```

7. Deploy the functions:

   ```sh
   supabase functions deploy credential-write
   supabase functions deploy credential-health
   supabase functions deploy journey-run
   supabase functions deploy github-installation
   supabase functions deploy github-webhook
   supabase functions deploy release-worker
   supabase functions deploy release-action
   ```

Do not run `supabase/seed.sql` against the hosted project. It is local
development data only.

## GitHub App

Create a GitHub App owned by the GitHub organization that will install
CanaryGrid.

Use these values:

- App name: `CanaryGrid` or an available organization-specific variant
- Homepage URL: `https://YOUR_APP_DOMAIN`
- Callback URL: `https://YOUR_APP_DOMAIN/settings?github=callback`
- Setup URL: `https://YOUR_APP_DOMAIN/settings?github=callback`
- Redirect on update: enabled
- Webhook URL:
  `https://YOUR_PROJECT_REF.supabase.co/functions/v1/github-webhook`
- Webhook secret: generate a strong random value with
  `openssl rand -hex 32`

Repository permissions:

- Checks: read and write
- Contents: read
- Metadata: read
- Pull requests: read

Subscribe to:

- Installation
- Installation repositories
- Pull request

Do not grant administration or repository code-write permission.

After the App is created:

1. Note the App ID.
2. Note the public App slug from its GitHub URL.
3. Generate and download one private key.
4. Configure the server-only secrets:

   ```sh
   supabase secrets set \
     GITHUB_APP_ID="YOUR_APP_ID" \
     GITHUB_APP_SLUG="YOUR_APP_SLUG" \
     GITHUB_PRIVATE_KEY="$(cat /path/to/downloaded-key.pem)" \
     GITHUB_WEBHOOK_SECRET="YOUR_WEBHOOK_SECRET"
   ```

5. Redeploy the three GitHub-facing functions:

   ```sh
   supabase functions deploy github-installation
   supabase functions deploy github-webhook
   supabase functions deploy release-worker
   supabase functions deploy release-action
   ```

6. In CanaryGrid, open Settings as a workspace owner, select **Connect
   GitHub**, and complete GitHub's installation screen.
7. Confirm that the selected repository appears in Settings.
8. Open or synchronize a pull request that changes a configured capability
   path. Confirm that GitHub shows the **CanaryGrid tenant compatibility**
   check and that its details link opens the matching release in CanaryGrid.

Installation tokens are created on demand and are never stored in the database.
The downloaded private key should be deleted from the workstation after the
secret is configured.
