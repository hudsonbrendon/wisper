# Supabase backend

## One-time project setup
1. Create a project at https://supabase.com (free tier is fine).
2. Authentication → Providers → Google: enable it. Create an OAuth client in
   Google Cloud Console (type "Web application"). Set the **Authorized redirect URI**
   to your Supabase callback: `https://<project-ref>.supabase.co/auth/v1/callback`.
   Paste the Google client ID + secret into the Supabase Google provider form.
3. Authentication → URL Configuration → **Redirect URLs**: add `http://127.0.0.1:*`
   (the desktop app uses an ephemeral loopback port — the wildcard allows any port).
4. Apply the schema: paste `migrations/0001_profiles.sql` into the SQL Editor and run it,
   OR use the Supabase CLI: `supabase db push`.

## Client config
Copy the project URL and the **anon/public** key into the app's `.env`:
```
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon-key>
```
The anon key is publishable; RLS enforces data safety. Never ship the service-role key.

## Verifying RLS
After a test sign-in, in the SQL editor run `select id, email, plan from public.profiles;`
— you should see exactly one row per user with `plan = 'free'`. As a signed-in client,
`update profiles set plan = 'pro'` must FAIL (RLS denies the plan change).
