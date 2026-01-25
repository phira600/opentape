# opentape

Real-time trade data aggregation and API platform.

## Complete Setup Guide

This guide walks you through deploying opentape from scratch using **GitHub**, **GitHub Codespaces**, **Supabase**, and **Vercel**. No local development environment required.

### Prerequisites

You'll need accounts on these free services:
- [GitHub](https://github.com) - Code hosting
- [Supabase](https://supabase.com) - Backend (database, authentication, edge functions)
- [Vercel](https://vercel.com) - Frontend hosting

---

## Step 1: Fork the Repository

1. Go to the opentape repository on GitHub
2. Click the **Fork** button in the top-right corner
3. Select your GitHub account as the destination
4. Wait for the fork to complete - you now have your own copy of opentape

---

## Step 2: Create a Supabase Project

1. Go to [supabase.com](https://supabase.com) and sign up (you can use your GitHub account)
2. Click **New Project**
3. Fill in:
   - **Name:** `opentape` (or any name you prefer)
   - **Database Password:** Create a strong password and **save it somewhere safe**
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

---

## Step 4: Install Supabase CLI and Login

In the Codespaces terminal (bottom of the screen), run these commands:

```bash
# Install Supabase CLI
npm install -g supabase

# Login to Supabase (this opens a browser window)
supabase login
```

When prompted, authorize the CLI in the browser window that opens.

---

## Step 5: Link to Your Supabase Project

```bash
# Link this codebase to your Supabase project
supabase link --project-ref YOUR_PROJECT_ID
```

Replace `YOUR_PROJECT_ID` with the Project ID you saved earlier (the `xxxxx` part from your URL).

When prompted for the database password, enter the password you created in Step 2.

---

## Step 6: Run Database Migrations

This creates all the tables and configurations needed:

```bash
supabase db push
```

Type `y` when asked to confirm.

---

## Step 7: Deploy Edge Functions

```bash
supabase functions deploy
```

This deploys all the backend functions. Wait for each one to complete.

---

## Step 8: Enable Required Extensions

In Supabase dashboard:

1. Go to **Database** → **Extensions** (in the left sidebar)
2. Search for and enable these extensions:
   - `pg_cron` - For scheduled tasks
   - `pg_net` - For HTTP requests from the database

---

## Step 9: Bootstrap the Admin User

Run this command in Codespaces (replace YOUR_PROJECT_ID):

```bash
curl -X POST https://YOUR_PROJECT_ID.supabase.co/functions/v1/provision-default-admin
```

You should see a response with:
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

> **Note:** You do NOT need to create or edit a `.env` file in your repository. Vercel injects these environment variables during the build process. The `.env` file is only needed for local development.

6. Click **Deploy**
7. Wait 1-2 minutes for the build to complete

Your app is now live! Click the URL Vercel gives you to open it.

---

## Step 11: Complete Initial Setup

1. Open your deployed app URL
2. Click **Login**
3. Enter the default credentials:
   - Email: `admin@opentape.local`
   - Password: `admin123!`
4. **Immediately change your password** in Settings

### Initialize Data Sources and Cron Jobs

After logging in, you need to initialize the system. You can do this via the Codespaces terminal:

First, get your access token from the browser:
1. Open browser Developer Tools (F12 or right-click → Inspect)
2. Go to **Application** tab → **Local Storage** → your app URL
3. Find the key that contains `access_token` and copy the token value

Then run these commands in Codespaces:

```bash
# Set up default data sources
curl -X POST https://YOUR_PROJECT_ID.supabase.co/functions/v1/provision-default-jobs \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"

# Set up scheduled tasks
curl -X POST https://YOUR_PROJECT_ID.supabase.co/functions/v1/provision-cron-jobs \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

Replace `YOUR_PROJECT_ID` and `YOUR_ACCESS_TOKEN` with your values.

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

### Edge functions not working
- Check Supabase Dashboard → Edge Functions → Logs for errors
- Make sure all environment variables are set correctly in Vercel

### Data not appearing
- Check that cron jobs are enabled in Supabase Dashboard → Database → Extensions → pg_cron
- View logs in Supabase Dashboard → Edge Functions

### Need to redeploy after changes
- Push changes to GitHub - Vercel auto-deploys
- For edge functions: run `supabase functions deploy` again in Codespaces

---

## Updating Your Installation

When new versions are released:

1. Sync your fork with the original repository (GitHub has a "Sync fork" button)
2. Open Codespaces on your updated fork
3. Run `supabase db push` if there are new migrations
4. Run `supabase functions deploy` if there are function changes
5. Vercel auto-deploys frontend changes

---

## Local Development

If you want to run opentape on your local machine (for development or testing), you'll need to set up environment variables locally.

### Prerequisites

- Node.js 18+ installed
- npm or bun package manager

### Setup

1. Clone your forked repository:
   ```bash
   git clone https://github.com/YOUR_USERNAME/opentape.git
   cd opentape
   ```

2. Copy the example environment file:
   ```bash
   cp .env.example .env
   ```

3. Edit `.env` and fill in your Supabase credentials:
   ```env
   VITE_SUPABASE_URL=https://your-project-id.supabase.co
   VITE_SUPABASE_PUBLISHABLE_KEY=your-anon-key
   VITE_SUPABASE_PROJECT_ID=your-project-id
   ```

4. Install dependencies:
   ```bash
   npm install
   ```

5. Start the development server:
   ```bash
   npm run dev
   ```

6. Open http://localhost:8080 in your browser

> **Note:** The `.env` file is gitignored and should never be committed to the repository. Each developer needs their own `.env` file with their Supabase credentials.

---

## Technology Stack

- **Frontend:** Vite, TypeScript, React, shadcn-ui, Tailwind CSS
- **Backend:** Supabase (PostgreSQL, Auth, Edge Functions)
- **Hosting:** Any static host (Vercel, Netlify, Cloudflare Pages)

---

## Alternative: Manual Database Setup

If you prefer to run migrations manually instead of using `supabase db push`:

1. Go to Supabase Dashboard → SQL Editor
2. Open each file in the `supabase/migrations/` folder (in order by date)
3. Copy and run each migration

---

## License

See LICENSE file for details.
