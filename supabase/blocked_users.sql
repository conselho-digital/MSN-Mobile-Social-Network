-- ============================================================
-- MSN - Mobile Social Network — Pessoas bloqueadas
-- ------------------------------------------------------------
-- Rode este script no SQL Editor do Supabase. É idempotente (pode
-- rodar de novo com segurança).
--
-- Contexto: bloqueio é independente de já ser contato ou não (dá pra
-- bloquear alguém que nunca foi adicionado) — por isso é uma tabela
-- própria, e não uma coluna em public.contacts.
-- ============================================================

create table if not exists public.blocked_users (
  id           bigint generated always as identity primary key,
  owner_id     uuid not null references public.profiles (id) on delete cascade,
  blocked_id   uuid not null references public.profiles (id) on delete cascade,
  created_at   timestamptz not null default now(),
  unique (owner_id, blocked_id)
);

alter table public.blocked_users enable row level security;

drop policy if exists "Ver os próprios bloqueios" on public.blocked_users;
create policy "Ver os próprios bloqueios"
  on public.blocked_users for select
  to authenticated
  using (auth.uid() = owner_id);

drop policy if exists "Gerenciar os próprios bloqueios" on public.blocked_users;
create policy "Gerenciar os próprios bloqueios"
  on public.blocked_users for all
  to authenticated
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

-- ============================================================
-- Fim. 🎉
-- ============================================================
