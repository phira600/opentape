# opentape

Real-time trade data aggregation and API platform.

## Quick Start (New Installation)

After deploying to Supabase, run these commands to set up the system:

```bash
# 1. Create the first admin user
curl -X POST https://YOUR_PROJECT_ID.supabase.co/functions/v1/provision-default-admin

# 2. Set up default data sources (CBOE, Nasdaq Nordic)
curl -X POST https://YOUR_PROJECT_ID.supabase.co/functions/v1/provision-default-jobs

# 3. Set up cron jobs for scheduled tasks
curl -X POST https://YOUR_PROJECT_ID.supabase.co/functions/v1/provision-cron-jobs
```

Replace `YOUR_PROJECT_ID` with your Supabase project ID.

### Default Admin Credentials
- **Email:** `admin@opentape.local`
- **Password:** `admin123!`

⚠️ **Change the password immediately after first login!**

### What Gets Set Up

**Data Sources** (via `provision-default-jobs`):
- CBOE BXE, CXE, DXE trade feeds
- Nasdaq Nordic trade feed

**Cron Jobs** (via `provision-cron-jobs`):
- `fetch-trade-files-weekdays`: Fetches trades every minute on weekdays
- `cleanup-old-trades-daily`: Trades cleanup daily
- `refresh-candles-5min`: Refreshes price candles every 5 minutes
- `cboe-sis-symbology-daily`: Updates symbol data at 8 AM UTC on weekdays

### Manual Admin Setup (Alternative)

1. Create a user account in the backend authentication system
2. Assign admin role by running this SQL:

```sql
INSERT INTO public.user_roles (user_id, role)
VALUES ('USER_UUID_HERE', 'admin');
```

Once the admin user is set up, they can invite other users from the Settings page.

## Project info

**URL**: https://lovable.dev/projects/REPLACE_WITH_PROJECT_ID

## How can I edit this code?

There are several ways of editing your application.

**Use Lovable**

Simply visit the [Lovable Project](https://lovable.dev/projects/REPLACE_WITH_PROJECT_ID) and start prompting.

Changes made via Lovable will be committed automatically to this repo.

**Use your preferred IDE**

If you want to work locally using your own IDE, you can clone this repo and push changes. Pushed changes will also be reflected in Lovable.

The only requirement is having Node.js & npm installed - [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating)

Follow these steps:

```sh
# Step 1: Clone the repository using the project's Git URL.
git clone <YOUR_GIT_URL>

# Step 2: Navigate to the project directory.
cd <YOUR_PROJECT_NAME>

# Step 3: Install the necessary dependencies.
npm i

# Step 4: Start the development server with auto-reloading and an instant preview.
npm run dev
```

**Edit a file directly in GitHub**

- Navigate to the desired file(s).
- Click the "Edit" button (pencil icon) at the top right of the file view.
- Make your changes and commit the changes.

**Use GitHub Codespaces**

- Navigate to the main page of your repository.
- Click on the "Code" button (green button) near the top right.
- Select the "Codespaces" tab.
- Click on "New codespace" to launch a new Codespace environment.
- Edit files directly within the Codespace and commit and push your changes once you're done.

## What technologies are used for this project?

This project is built with:

- Vite
- TypeScript
- React
- shadcn-ui
- Tailwind CSS

## How can I deploy this project?

Simply open [Lovable](https://lovable.dev/projects/REPLACE_WITH_PROJECT_ID) and click on Share -> Publish.

## Can I connect a custom domain to my Lovable project?

Yes, you can!

To connect a domain, navigate to Project > Settings > Domains and click Connect Domain.

Read more here: [Setting up a custom domain](https://docs.lovable.dev/features/custom-domain#custom-domain)
