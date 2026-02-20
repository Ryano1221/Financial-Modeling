-- Phase 1: Supabase auth-scoped branding persistence
-- Run this in Supabase SQL editor for the production project.

create extension if not exists pgcrypto;

create table if not exists public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  brokerage_name text,
  brokerage_logo_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_user_settings_updated_at on public.user_settings;
create trigger trg_user_settings_updated_at
before update on public.user_settings
for each row
execute function public.set_updated_at();

alter table public.user_settings enable row level security;

drop policy if exists user_settings_select_own on public.user_settings;
create policy user_settings_select_own
on public.user_settings
for select
using (auth.uid() = user_id);

drop policy if exists user_settings_insert_own on public.user_settings;
create policy user_settings_insert_own
on public.user_settings
for insert
with check (auth.uid() = user_id);

drop policy if exists user_settings_update_own on public.user_settings;
create policy user_settings_update_own
on public.user_settings
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists user_settings_delete_own on public.user_settings;
create policy user_settings_delete_own
on public.user_settings
for delete
using (auth.uid() = user_id);

insert into storage.buckets (id, name, public)
values ('logos', 'logos', false)
on conflict (id) do update
set public = excluded.public;

drop policy if exists logos_select_own on storage.objects;
create policy logos_select_own
on storage.objects
for select
using (
  bucket_id = 'logos'
  and (storage.foldername(name))[1] = 'logos'
  and (storage.foldername(name))[2] = auth.uid()::text
);

drop policy if exists logos_insert_own on storage.objects;
create policy logos_insert_own
on storage.objects
for insert
with check (
  bucket_id = 'logos'
  and (storage.foldername(name))[1] = 'logos'
  and (storage.foldername(name))[2] = auth.uid()::text
);

drop policy if exists logos_update_own on storage.objects;
create policy logos_update_own
on storage.objects
for update
using (
  bucket_id = 'logos'
  and (storage.foldername(name))[1] = 'logos'
  and (storage.foldername(name))[2] = auth.uid()::text
)
with check (
  bucket_id = 'logos'
  and (storage.foldername(name))[1] = 'logos'
  and (storage.foldername(name))[2] = auth.uid()::text
);

drop policy if exists logos_delete_own on storage.objects;
create policy logos_delete_own
on storage.objects
for delete
using (
  bucket_id = 'logos'
  and (storage.foldername(name))[1] = 'logos'
  and (storage.foldername(name))[2] = auth.uid()::text
);
