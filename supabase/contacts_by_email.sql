-- ============================================================
-- Adicionar contato por e-mail + Criar grupo
-- ------------------------------------------------------------
-- Como usar: cole no SQL Editor do Supabase e clique em "Run".
-- Só precisa rodar isso se seu banco já existia antes desta versão
-- (contas novas via supabase/schema.sql já saem prontas).
-- ============================================================

-- 1) profiles.email: identidade usada para buscar/adicionar contatos,
--    como o Passport clássico do MSN (em vez de buscar por nome).
alter table public.profiles add column if not exists email text;

-- Preenche quem já tem conta, usando o e-mail do auth.users.
update public.profiles p
set email = u.email
from auth.users u
where p.id = u.id and p.email is null;

-- Atualiza o gatilho de criação de perfil para gravar o e-mail
-- também em contas novas.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, sub_nick, birthdate, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data ->> 'sub_nick', ''),
    (nullif(new.raw_user_meta_data ->> 'birthdate', ''))::date,
    new.email
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- 2) TABELA: groups
--    Grupos criados pela pessoa para organizar os contatos
--    ("Criar um grupo..." no menu Adicionar).
create table if not exists public.groups (
  id           bigint generated always as identity primary key,
  owner_id     uuid not null references public.profiles (id) on delete cascade,
  name         text not null,
  member_ids   uuid[] not null default '{}',
  created_at   timestamptz not null default now()
);

alter table public.groups enable row level security;

drop policy if exists "Ver os próprios grupos" on public.groups;
create policy "Ver os próprios grupos"
  on public.groups for select
  to authenticated
  using (auth.uid() = owner_id);

drop policy if exists "Gerenciar os próprios grupos" on public.groups;
create policy "Gerenciar os próprios grupos"
  on public.groups for all
  to authenticated
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);
