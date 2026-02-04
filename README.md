# opentape

Real-time trade data aggregation and API platform.

## Deployment Guide

Deploy opentape in under 30 minutes using **GitHub Codespaces** (for backend setup) and **Vercel** (for hosting). No local development environment required.

### Prerequisites

You'll need accounts on these free services:
- [GitHub](https://github.com) - Code hosting (Codespaces free tier: 60 hours/month)
- [Supabase](https://supabase.com) - Backend (database, authentication, edge functions)
- [Vercel](https://vercel.com) - Frontend hosting

---

## Step 1: Fork the Repository

1. Go to the opentape repository on GitHub (the URL where you found this README)
2. Click the **Fork** button in the top-right corner
3. Select your GitHub account as the destination
4. Wait for the fork to complete - you now have your own copy of opentape

---

## Step 2: Create a Supabase Project

1. Go to [supabase.com](https://supabase.com) and sign up (you can use your GitHub account)
2. Click **New Project**
3. Fill in:
   - **Name:** `opentape` (or any name you prefer)
   - **Database Password:** Create a strong password using only letters and numbers (avoid special characters like `$`, `@`, `!` as they can cause issues)
   - **Region:** Choose the closest to your users
4. Click **Create new project** and wait 2-3 minutes for setup

### Get Your Supabase Credentials

1. In your Supabase project, go to **Settings** → **API** (in the left sidebar)
2. Copy these values and save them somewhere (you'll need them later):

| Value | Where to Find It |
|-------|------------------|
| Project URL | Under "Project URL" (looks like `https://xxxxx.supabase.co`) |
| Anon Key | Under "Project API keys" → `anon` `public` |
| Service Role Key | Under "Project API keys" → `service_role` (click "Reveal") |
| Project ID | The `xxxxx` part from your Project URL |

---

## Step 3: Open GitHub Codespaces

GitHub Codespaces gives you a cloud development environment - no need to install anything locally.

1. Go to your forked opentape repository on GitHub
2. Click the green **Code** button
3. Select the **Codespaces** tab
4. Click **Create codespace on main**
5. Wait 2-3 minutes for the environment to load

You now have a VS Code editor in your browser with all tools pre-installed.

> **Note:** Codespaces free tier includes 60 hours/month. If your session times out, just reconnect and continue from where you left off.

---

## Step 4: Login to Supabase CLI

In the Codespaces terminal (bottom of the screen), run this command:

```bash
npx supabase login
```

When prompted, authorize the CLI in the browser window that opens.

> **Note:** We use `npx` to run the Supabase CLI directly without installation. All subsequent `supabase` commands should be prefixed with `npx`.

---

## Step 5: Link to Your Supabase Project

```bash
npx supabase link --project-ref YOUR_PROJECT_ID
```

Replace `YOUR_PROJECT_ID` with the Project ID you saved earlier (the `xxxxx` part from your URL).

When prompted for the database password, enter the password you created in Step 2.

---

## Step 6: Enable Required Extensions

In Supabase dashboard:

1. Go to **Database** → **Extensions** (in the left sidebar)
2. Search for and enable these extensions:
   - `pg_cron` - For scheduled tasks
   - `pg_net` - For HTTP requests from the database

> **Important:** Enable these extensions before running migrations to ensure all database features work correctly.

---

## Step 7: Run Database Migrations

This creates all the tables and configurations needed:

```bash
npx supabase db push
```

Type `y` when asked to confirm.

---

## Step 8: Deploy Edge Functions

```bash
npx supabase functions deploy
```

This deploys all the backend functions. Wait for each one to complete.

### Verify Deployment

After deployment finishes:
1. Go to your Supabase dashboard
2. Navigate to **Edge Functions** in the left sidebar
3. Confirm you see all functions listed (should be around 12-15 functions)

> **Note:** Wait about 30-60 seconds after deployment before proceeding to the next step. Edge functions need time to become available.

---

## Step 9: Bootstrap the Admin User

Run this command in Codespaces (replace `YOUR_PROJECT_ID` with your actual project ID):

```bash
curl -X POST https://YOUR_PROJECT_ID.supabase.co/functions/v1/provision-default-admin
```

You should see a response like:
```json
{
  "success": true,
  "credentials": {
    "email": "admin@opentape.local",
    "password": "admin123!"
  }
}
```

**Save these credentials** - you'll use them to log in.

> **Troubleshooting:** If you get a 404 error, wait another 30 seconds and try again. If it still fails, check that edge functions deployed successfully in Step 8.

---

## Step 10: Deploy to Vercel

1. Go to [vercel.com](https://vercel.com) and sign up with your GitHub account
2. Click **Add New...** → **Project**
3. Find your forked `opentape` repository and click **Import**
4. In the configuration screen:
   - **Framework Preset:** Vite (should auto-detect)
   - **Root Directory:** Leave as `.` (default)
5. Expand **Environment Variables** and add:

| Name | Value |
|------|-------|
| `VITE_SUPABASE_URL` | Your Project URL (e.g., `https://xxxxx.supabase.co`) |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Your Anon Key |
| `VITE_SUPABASE_PROJECT_ID` | Your Project ID |

> **Note:** You do NOT need to create or edit a `.env` file in your repository. Vercel injects these environment variables during the build process.

6. Click **Deploy**
7. Wait 1-2 minutes for the build to complete

Your app is now live! Click the URL Vercel gives you to open it.

---

## Step 11: Complete Initial Setup

1. Open your deployed app URL
2. You'll be redirected to the login page automatically
3. Enter the default credentials:
   - Email: `admin@opentape.local`
   - Password: `admin123!`
4. **Important:** Change your password immediately in Settings after logging in

### Initialize Data Sources and Cron Jobs

After logging in, set up the data pipelines using these commands in Codespaces.

**Option A: Using Service Role Key (Recommended for initial setup)**

Run these commands using your Service Role Key (simpler, no need to extract tokens):

```bash
# Set up default data sources
curl -X POST https://YOUR_PROJECT_ID.supabase.co/functions/v1/provision-default-jobs \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY"

# Set up scheduled tasks
curl -X POST https://YOUR_PROJECT_ID.supabase.co/functions/v1/provision-cron-jobs \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY"
```

Replace:
- `YOUR_PROJECT_ID` with your Supabase project ID
- `YOUR_SERVICE_ROLE_KEY` with your Service Role Key from Step 2

**Option B: Using Access Token (Alternative)**

If you prefer to use your logged-in session:
1. Open browser Developer Tools (F12 or right-click → Inspect)
2. Go to **Application** tab → **Local Storage** → your app URL
3. Find the key starting with `sb-` that contains `access_token`
4. Copy the `access_token` value from within that JSON object
5. Use that token in place of `YOUR_SERVICE_ROLE_KEY` above

---

## You're Done! 🎉

Your opentape instance is now fully configured with:
- ✅ Database with all tables
- ✅ Authentication system
- ✅ Edge functions deployed
- ✅ Admin user created
- ✅ Data sources configured
- ✅ Scheduled tasks running

---

## Troubleshooting

### "Invalid login credentials"
- Make sure you're using `admin@opentape.local` (not your email)
- Password is `admin123!` (with the exclamation mark)

### Edge function returns 404
- Wait 30-60 seconds after deployment before calling functions
- Check Supabase Dashboard → Edge Functions to verify deployment
- Try redeploying with `npx supabase functions deploy`

### "Database password error" during linking
- Avoid special characters like `$`, `@`, `!` in your database password
- If needed, reset password in Supabase Dashboard → Settings → Database

### Codespaces session expired
- Simply reconnect to Codespaces and continue from where you left off
- Your progress is saved; just run the next command in sequence

### Edge functions not working
- Check Supabase Dashboard → Edge Functions → Logs for errors
- Make sure all environment variables are set correctly in Vercel

### Data not appearing
- Check that cron jobs are enabled in Supabase Dashboard → Database → Extensions → pg_cron
- View logs in Supabase Dashboard → Edge Functions

### "provision-default-admin" returns error about existing admin
- This is expected! The admin user already exists
- Just proceed to login with the default credentials

### Need to redeploy after changes
- Push changes to GitHub - Vercel auto-deploys
- For edge functions: run `npx supabase functions deploy` again in Codespaces

---

## Updating Your Installation

When new versions are released:

1. Sync your fork with the original repository (GitHub has a "Sync fork" button)
2. Open Codespaces on your updated fork
3. Run `npx supabase db push` if there are new migrations
4. Run `npx supabase functions deploy` if there are function changes
5. Vercel auto-deploys frontend changes

---

## Technology Stack

- **Frontend:** Vite, TypeScript, React, shadcn-ui, Tailwind CSS
- **Backend:** Supabase (PostgreSQL, Auth, Edge Functions)
- **Hosting:** Vercel (or any static host)

---

## Local Development

For contributors who want to run opentape locally, see [DEVELOPMENT.md](DEVELOPMENT.md).

---

## License

See LICENSE file for details.
