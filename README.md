# The Wardrobe

A personal wardrobe tracker with tag-based outfit generation, laundry state, cost-per-wear insights, and photos — backed by Supabase so your closet syncs across every device.

## How data is stored

- **Items** live in a Postgres table (`items`) with Row Level Security, so each signed-in user can only ever read or write their own closet.
- **Photos** are compressed in the browser (max 900px JPEG), then uploaded as real image files to a private Supabase Storage bucket at `<user_id>/<item_id>.jpg`. The app displays them through short-lived signed URLs, so photos are never publicly accessible.
- **Sign-in** is passwordless: a magic link sent to your email.

## Setup (about 20 minutes)

### 1. Create the Supabase project

1. Go to [supabase.com](https://supabase.com), sign up (free), and create a new project. Pick a region near you (e.g. `eu-central-1` / Frankfurt).
2. Wait for the project to finish provisioning.

### 2. Create the storage bucket

1. In the dashboard, go to **Storage → New bucket**.
2. Name it exactly `photos` and leave **Public bucket** switched **off**.

### 3. Run the schema

1. Go to **SQL Editor → New query**.
2. Paste the entire contents of `supabase/schema.sql` from this project and click **Run**. This creates the `items` table, its security policy, and the storage policies.

### 4. Configure the app

1. In the dashboard, go to **Project Settings → API**. Copy the **Project URL** and the **anon public** key.
2. In this project folder, copy `.env.example` to `.env` and paste in both values:

```
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
```

The anon key is safe to expose in a frontend — Row Level Security is what protects the data.

### 5. Run it locally

```bash
npm install
npm run dev
```

Open the printed URL, sign in with your email, click the magic link, and start adding pieces.

## Deploy to Vercel

1. Push this folder to a GitHub repository.
2. Go to [vercel.com](https://vercel.com), import the repository. Vercel auto-detects Vite — the defaults are correct.
3. Under **Environment Variables**, add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` with the same values as your `.env`.
4. Deploy. You'll get a URL like `https://wardrobe-yourname.vercel.app`.
5. **Important:** in Supabase go to **Authentication → URL Configuration** and set **Site URL** to your Vercel URL (and add it under Redirect URLs). Otherwise magic links will point at localhost.

## Use it like a phone app

Open your Vercel URL on your phone, then:
- **iPhone (Safari):** Share → Add to Home Screen
- **Android (Chrome):** Menu (⋮) → Add to Home screen

It gets its own icon and opens full-screen.

## Notes

- The free Supabase tier includes 500 MB database + 1 GB storage — with compressed photos that's thousands of garments.
- Free-tier projects pause after ~1 week of inactivity; just hit the dashboard to wake them, or open the app regularly.
- Magic-link emails on the free tier are rate-limited to a few per hour, which is fine for personal use since sessions persist for a long time.
