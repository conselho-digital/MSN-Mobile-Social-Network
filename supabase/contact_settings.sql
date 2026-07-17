-- ============================================================
-- MSN - Mobile Social Network — Silenciar / Aparecer offline / Bloqueio de verdade
-- ------------------------------------------------------------
-- Como usar: cole no SQL Editor do Supabase e clique em "Run". É
-- idempotente (pode rodar de novo com segurança). Depende do
-- schema.sql, blocked_users.sql, favorites.sql e security_hardening.sql
-- já terem rodado antes.
--
-- O que isso adiciona:
--   1) contacts.is_muted / contacts.appear_offline — duas escolhas
--      pessoais sobre CADA contato (igual a is_favorite, já existente):
--      silenciar notificações desse contato, ou aparecer offline só
--      pra ele (sem mexer no seu status de verdade pros outros).
--   2) get_forced_offline_contacts() — pra cada contato meu, diz se eu
--      devo aparecer OFFLINE pra ele (porque ele me bloqueou, ou
--      porque eu escolhi aparecer offline só pra ele) — usada pelo
--      app pra saber quando mostrar um contato como offline mesmo com
--      o status real dizendo outra coisa.
--   3) get_contact_profiles(ids) — mesma consulta que getContacts() já
--      fazia direto em "profiles", mas escondendo foto/cenário/cor do
--      tema de quem me bloqueou (antes ainda dava pra ver, se a gente
--      já fosse contato mútuo antes do bloqueio) — sem tirar o contato
--      da lista inteira (ele continua aparecendo, só sempre offline e
--      sem essas informações, pra dar pra abrir a conversa e ver o
--      aviso de bloqueio).
-- ============================================================

-- ------------------------------------------------------------
-- 1) Colunas novas em contacts (mesma ideia de is_favorite)
-- ------------------------------------------------------------
alter table public.contacts
  add column if not exists is_muted boolean not null default false;
alter table public.contacts
  add column if not exists appear_offline boolean not null default false;

-- ------------------------------------------------------------
-- 2) Pra cada contato meu, diz se devo aparecer OFFLINE pra ele —
--    combinando duas razões possíveis (ele me bloqueou / eu escolhi
--    aparecer offline só pra ele) numa única consulta, em vez do app
--    ter que perguntar contato por contato.
-- ------------------------------------------------------------
create or replace function public.get_forced_offline_contacts()
returns table(contact_id uuid, reason text)
language sql
security definer
set search_path = public
stable
as $$
  select c.contact_id, 'blocked'::text as reason
  from public.contacts c
  where c.owner_id = auth.uid()
    and exists (
      select 1 from public.blocked_users b
      where b.owner_id = c.contact_id and b.blocked_id = auth.uid()
    )
  union
  select c.contact_id, 'appear_offline'::text as reason
  from public.contacts c
  where c.owner_id = auth.uid()
    and exists (
      select 1 from public.contacts rc
      where rc.owner_id = c.contact_id
        and rc.contact_id = auth.uid()
        and rc.appear_offline = true
    );
$$;

grant execute on function public.get_forced_offline_contacts() to authenticated;

-- ------------------------------------------------------------
-- 3) Perfis dos meus contatos, com foto/cenário/cor do tema escondidos
--    de quem me bloqueou — chamada pelo app no lugar de ler "profiles"
--    direto (ver getContacts() em js/supabase-client.js). Continua só
--    devolvendo quem já era visível antes (eu mesmo, meus contatos, ou
--    quem eu bloqueei), igual a política de security_hardening.sql —
--    só adiciona a máscara de campos por cima.
-- ------------------------------------------------------------
create or replace function public.get_contact_profiles(target_ids uuid[])
returns table(
  id uuid,
  display_name text,
  sub_nick text,
  status text,
  avatar_url text,
  birthdate date,
  created_at timestamptz,
  updated_at timestamptz,
  scene text,
  color_scheme text,
  scene_image_url text,
  email text
)
language sql
security definer
set search_path = public
stable
as $$
  select
    p.id,
    p.display_name,
    case when blocked_me then null else p.sub_nick end,
    p.status,
    case when blocked_me then null else p.avatar_url end,
    p.birthdate,
    p.created_at,
    p.updated_at,
    case when blocked_me then null else p.scene end,
    case when blocked_me then null else p.color_scheme end,
    case when blocked_me then null else p.scene_image_url end,
    p.email
  from public.profiles p
  cross join lateral (
    select exists (
      select 1 from public.blocked_users b
      where b.owner_id = p.id and b.blocked_id = auth.uid()
    ) as blocked_me
  ) bm
  where p.id = any(target_ids)
    and (
      p.id = auth.uid()
      or exists (select 1 from public.contacts where contacts.owner_id = auth.uid() and contacts.contact_id = p.id)
      or exists (select 1 from public.blocked_users where blocked_users.owner_id = auth.uid() and blocked_users.blocked_id = p.id)
    );
$$;

grant execute on function public.get_contact_profiles(uuid[]) to authenticated;

-- ============================================================
-- Fim. 🎉
-- ============================================================
