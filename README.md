# opentape

Real-time trade data aggregation and API platform.

## Self-Hosting

This application can be deployed to any static hosting service. The backend (database, edge functions, authentication) runs on Supabase.

### Prerequisites

- Node.js 18+ installed
- A Supabase project with the database schema deployed

### Environment Variables

Copy `.env.example` to `.env` and configure:

| Variable | Description |
|----------|-------------|
| `VITE_SUPABASE_URL` | Your Supabase project URL (e.g., `https://xxxxx.supabase.co`) |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Your Supabase anon/public key |
| `VITE_SUPABASE_PROJECT_ID` | Your Supabase project ID |

### Deploy to Vercel

1. Fork/clone this repository to your GitHub account
2. Import the repository to [Vercel](https://vercel.com)
3. Add environment variables in Vercel dashboard (Settings > Environment Variables)
4. Deploy

### Deploy to Netlify

1. Fork/clone this repository to your GitHub account
2. Connect to [Netlify](https://netlify.com)
3. Build command: `npm run build`
4. Publish directory: `dist`
5. Add environment variables in Netlify dashboard
6. Deploy

### Deploy to Cloudflare Pages

1. Fork/clone this repository
2. Connect to [Cloudflare Pages](https://pages.cloudflare.com)
3. Build command: `npm run build`
4. Build output directory: `dist`
5. Add environment variables
6. Deploy

### Manual Build

```bash
# Install dependencies
npm install

# Build for production
npm run build

# The dist/ folder contains the static files to deploy
```

## Backend Setup (Supabase)

The backend requires a Supabase project. After creating your project:

1. Run all migrations from `supabase/migrations/` folder using Supabase CLI
2. Deploy edge functions from `supabase/functions/` folder
3. Run the provisioning commands below

### Quick Start (New Installation)

After deploying to Supabase, run these commands to set up the system:

```bash
# Step 1: Bootstrap the first admin user (no authentication required on fresh install)
curl -X POST https://YOUR_PROJECT_ID.supabase.co/functions/v1/provision-default-admin
```

This creates the default admin account. **Log in immediately and change the password!**

```bash
# Step 2: After logging in, get your JWT token and run these authenticated requests:

# Set up default data sources (CBOE, Nasdaq Nordic)
curl -X POST https://YOUR_PROJECT_ID.supabase.co/functions/v1/provision-default-jobs \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"

# Set up cron jobs for scheduled tasks
curl -X POST https://YOUR_PROJECT_ID.supabase.co/functions/v1/provision-cron-jobs \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

Replace `YOUR_PROJECT_ID` with your Supabase project ID.

> **Note:** The `provision-default-admin` endpoint only works without authentication on a fresh install (when no admins exist). Once an admin is created, the endpoint becomes protected.

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

## Technology Stack

- Vite
- TypeScript
- React
- shadcn-ui
- Tailwind CSS
- Supabase (Backend)

## Development

```bash
# Install dependencies
npm install

# Start development server
npm run dev
```

## License

See LICENSE file for details.
