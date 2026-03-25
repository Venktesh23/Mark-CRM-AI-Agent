-- Run this in Supabase SQL editor.
-- Requires Supabase Auth enabled (auth.users table).

create extension if not exists "pgcrypto";

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null default '',
  display_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.campaigns (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  status text not null check (status in ('draft', 'in_review', 'approved', 'sent')),
  prompt text not null default '',
  created_at timestamptz not null default now(),
  payload jsonb not null
);

create index if not exists campaigns_user_id_created_at_idx
  on public.campaigns (user_id, created_at desc);

alter table public.profiles enable row level security;
alter table public.campaigns enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
  on public.profiles
  for select
  using (auth.uid() = id);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
  on public.profiles
  for insert
  with check (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles
  for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

drop policy if exists "campaigns_select_own" on public.campaigns;
create policy "campaigns_select_own"
  on public.campaigns
  for select
  using (auth.uid() = user_id);

drop policy if exists "campaigns_insert_own" on public.campaigns;
create policy "campaigns_insert_own"
  on public.campaigns
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "campaigns_update_own" on public.campaigns;
create policy "campaigns_update_own"
  on public.campaigns
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "campaigns_delete_own" on public.campaigns;
create policy "campaigns_delete_own"
  on public.campaigns
  for delete
  using (auth.uid() = user_id);
