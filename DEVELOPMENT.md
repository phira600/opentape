# Local Development

This guide is for contributors who want to run opentape locally for development or testing.

## Prerequisites

- Node.js 18+ installed
- npm or bun package manager
- A Supabase project (see main README for setup)

## Setup

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

## Project Structure

```
opentape/
├── src/
│   ├── components/     # React components
│   ├── hooks/          # Custom React hooks
│   ├── pages/          # Page components
│   ├── integrations/   # Supabase client & types
│   └── lib/            # Utility functions
├── supabase/
│   ├── functions/      # Edge functions
│   └── migrations/     # Database migrations
└── public/             # Static assets
```

## Edge Function Development

To test edge functions locally, you'll need the Supabase CLI:

```bash
# Install Supabase CLI
brew install supabase/tap/supabase

# Start local Supabase services
supabase start

# Serve functions locally
supabase functions serve
```

## Contributing

1. Create a feature branch from `main`
2. Make your changes
3. Test locally
4. Submit a pull request

## Technology Stack

- **Frontend:** Vite, TypeScript, React, shadcn-ui, Tailwind CSS
- **Backend:** Supabase (PostgreSQL, Auth, Edge Functions)
- **Hosting:** Any static host (Vercel, Netlify, Cloudflare Pages)
