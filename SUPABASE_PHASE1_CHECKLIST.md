# Supabase Phase 1 Setup + Verification

## Required environment variables

### Frontend (`frontend/.env.local` and Vercel Production)
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `NEXT_PUBLIC_BACKEND_URL`

Do **not** set `SUPABASE_SERVICE_ROLE_KEY` in frontend env.

### Backend (`backend/.env` and Render Production)
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_LOGOS_BUCKET=logos` (optional; defaults to `logos`)
- `ALLOWED_ORIGINS=https://thecremodel.com,https://www.thecremodel.com`

## Supabase SQL

Run:

- `/Users/ryanarnold/Desktop/Lease Deck/backend/scripts/supabase_phase1.sql`

This creates:
- `public.user_settings`
- RLS policies (`auth.uid() = user_id`)
- private `logos` bucket
- per-user storage policies on `logos/{userId}/...`

## Manual acceptance checks

1. Sign up user A on `/`.
2. Upload brokerage logo and set brokerage name.
3. Export PDF deck and confirm logo is on cover/header/prepared-by.
4. Sign out and sign in as user B.
5. Confirm user B cannot see user A branding values/logo.
6. Upload user B logo, export PDF, confirm user B branding only.
7. Sign back in as user A and confirm user A branding is restored.

## Security checks

- No API accepts client-supplied `userId`.
- Backend derives user from `Authorization: Bearer <Supabase access token>`.
- `/reports` payload ownership is enforced by `owner_user_id`.
- `/reports/{id}`, `/reports/{id}/preview`, and `/reports/{id}/pdf` return `403` for other users.
