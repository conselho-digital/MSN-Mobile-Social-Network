-- ============================================================
-- MSN - Mobile Social Network — Esquema do Banco de Dados
-- ------------------------------------------------------------
-- Como usar:
--   1. Abra o painel do Supabase do seu projeto.
--   2. Vá em "SQL Editor" > "New query".
--   3. Cole TODO este arquivo e clique em "Run".
--
-- Este script é idempotente: pode ser executado novamente com
-- segurança (usa IF NOT EXISTS / DROP POLICY IF EXISTS).
-- ============================================================

-- ------------------------------------------------------------
-- 1) TABELA: profiles
--    Perfil público de cada usuário (ligado ao auth.users).
-- ------------------------------------------------------------
create table if not exists public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  display_name  text not null default 'Novo usuário',
  sub_nick      text default '',
  status        text not null default 'online'
                  check (status in ('online','busy','away','invisible','offline')),
  avatar_url    text,
  birthdate     date,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Caso a tabela já exista de uma execução anterior, garante as colunas novas.
alter table public.profiles add column if not exists birthdate date;
alter table public.profiles add column if not exists scene text default 'cenario1';
alter table public.profiles add column if not exists color_scheme text;
alter table public.profiles add column if not exists scene_image_url text;
alter table public.profiles add column if not exists email text;
-- Observação: a foto de exibição usa Supabase Storage — veja
-- supabase/personalization.sql (bucket "avatars" + políticas).
-- color_scheme: esquema de cores escolhido separadamente do cenário
-- (ver supabase/color_scheme.sql). NULL = usa a cor pareada ao cenário.
-- scene_image_url: cenário customizado enviado pela pessoa (botão
-- "Procurar..."), usado quando scene = 'custom' (ver custom_scene.sql).
-- email: identidade usada para buscar/adicionar contatos (como o
-- Passport clássico do MSN) — ver supabase/contacts_by_email.sql.

-- Preenche quem já tem conta, usando o e-mail do auth.users.
update public.profiles p
set email = u.email
from auth.users u
where p.id = u.id and p.email is null;

-- A galeria de cenários trocou os antigos ids (green/blue/aero/...)
-- pelas imagens em assets/scenes/cenarioN.webp — atualiza quem ainda
-- estiver com o valor antigo para o novo cenário padrão.
update public.profiles set scene = 'cenario1'
  where scene in ('green','blue','aero','purple','pink','sunset','teal','graphite','royal');

comment on table public.profiles is 'Perfis públicos dos usuários do MSN.';

-- ------------------------------------------------------------
-- 2) TABELA: messages
--    Mensagens trocadas entre dois usuários.
-- ------------------------------------------------------------
create table if not exists public.messages (
  id           bigint generated always as identity primary key,
  sender_id    uuid not null references public.profiles (id) on delete cascade,
  receiver_id  uuid not null references public.profiles (id) on delete cascade,
  content      text not null check (char_length(content) <= 2000),
  created_at   timestamptz not null default now()
);

create index if not exists messages_conversation_idx
  on public.messages (sender_id, receiver_id, created_at);
create index if not exists messages_receiver_idx
  on public.messages (receiver_id, created_at);

-- ------------------------------------------------------------
-- 3) TABELA: nudge_events
--    "Chamar a atenção" (tremida de tela) em tempo real.
-- ------------------------------------------------------------
create table if not exists public.nudge_events (
  id           bigint generated always as identity primary key,
  sender_id    uuid not null references public.profiles (id) on delete cascade,
  receiver_id  uuid not null references public.profiles (id) on delete cascade,
  created_at   timestamptz not null default now()
);

create index if not exists nudge_receiver_idx
  on public.nudge_events (receiver_id, created_at);

-- ------------------------------------------------------------
-- 4) TABELA: contacts
--    Lista de contatos (amizades) de cada usuário.
-- ------------------------------------------------------------
create table if not exists public.contacts (
  id           bigint generated always as identity primary key,
  owner_id     uuid not null references public.profiles (id) on delete cascade,
  contact_id   uuid not null references public.profiles (id) on delete cascade,
  created_at   timestamptz not null default now(),
  unique (owner_id, contact_id)
);

-- ------------------------------------------------------------
-- 4b) TABELA: groups
--     Grupos criados pela pessoa para organizar os contatos
--     ("Criar um grupo..." no menu Adicionar).
-- ------------------------------------------------------------
create table if not exists public.groups (
  id           bigint generated always as identity primary key,
  owner_id     uuid not null references public.profiles (id) on delete cascade,
  name         text not null,
  member_ids   uuid[] not null default '{}',
  created_at   timestamptz not null default now()
);

-- ============================================================
-- 5) TRIGGER: cria um profile automaticamente a cada novo usuário
-- ============================================================
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

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Mantém updated_at atualizado no profiles
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();

-- ============================================================
-- 6) ROW LEVEL SECURITY (RLS)
-- ============================================================
alter table public.profiles     enable row level security;
alter table public.messages     enable row level security;
alter table public.nudge_events enable row level security;
alter table public.contacts     enable row level security;
alter table public.groups       enable row level security;

-- ---- profiles ----
drop policy if exists "Perfis são visíveis para usuários autenticados" on public.profiles;
create policy "Perfis são visíveis para usuários autenticados"
  on public.profiles for select
  to authenticated
  using (true);

drop policy if exists "Usuário edita o próprio perfil" on public.profiles;
create policy "Usuário edita o próprio perfil"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

drop policy if exists "Usuário cria o próprio perfil" on public.profiles;
create policy "Usuário cria o próprio perfil"
  on public.profiles for insert
  to authenticated
  with check (auth.uid() = id);

-- ---- messages ----
drop policy if exists "Ver mensagens enviadas ou recebidas" on public.messages;
create policy "Ver mensagens enviadas ou recebidas"
  on public.messages for select
  to authenticated
  using (auth.uid() = sender_id or auth.uid() = receiver_id);

drop policy if exists "Enviar mensagens como remetente" on public.messages;
create policy "Enviar mensagens como remetente"
  on public.messages for insert
  to authenticated
  with check (auth.uid() = sender_id);

-- ---- nudge_events ----
drop policy if exists "Ver nudges recebidos ou enviados" on public.nudge_events;
create policy "Ver nudges recebidos ou enviados"
  on public.nudge_events for select
  to authenticated
  using (auth.uid() = sender_id or auth.uid() = receiver_id);

drop policy if exists "Enviar nudge como remetente" on public.nudge_events;
create policy "Enviar nudge como remetente"
  on public.nudge_events for insert
  to authenticated
  with check (auth.uid() = sender_id);

-- ---- contacts ----
drop policy if exists "Ver os próprios contatos" on public.contacts;
create policy "Ver os próprios contatos"
  on public.contacts for select
  to authenticated
  using (auth.uid() = owner_id);

drop policy if exists "Gerenciar os próprios contatos" on public.contacts;
create policy "Gerenciar os próprios contatos"
  on public.contacts for all
  to authenticated
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

-- ---- groups ----
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

-- ============================================================
-- 7) REALTIME
--    Habilita transmissão em tempo real (mensagens e nudges).
-- ============================================================
do $$
begin
  if not exists (
    select 1 from pg_publication where pubname = 'supabase_realtime'
  ) then
    create publication supabase_realtime;
  end if;
end $$;

alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.nudge_events;
alter publication supabase_realtime add table public.profiles;

-- ============================================================
-- Fim do script. 🎉
-- ============================================================
