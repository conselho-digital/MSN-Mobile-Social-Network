-- ============================================================
-- MSN - Mobile Social Network — Reforço de segurança
-- ------------------------------------------------------------
-- Como usar: cole no SQL Editor do Supabase e clique em "Run". É
-- idempotente (pode rodar de novo com segurança). Depende do
-- schema.sql, blocked_users.sql e contacts_by_email.sql já terem
-- rodado antes.
--
-- O que isso corrige (achados de uma revisão de segurança):
--
-- 1) profiles.select estava liberado com "using (true)" — QUALQUER
--    conta autenticada conseguia ler a tabela profiles INTEIRA (e-mail,
--    nome, data de nascimento, cenário, tudo) de QUALQUER outra pessoa,
--    mesmo sem serem contatos, direto pela API REST do Supabase (sem
--    precisar passar pelo app). Isso é um vazamento de privacidade —
--    dava pra "baixar" o e-mail de todo mundo cadastrado. Trocado para
--    só o próprio perfil + perfis de quem é contato/bloqueado (o
--    mínimo que a interface realmente precisa).
--
-- 2) addContactByEmail/blockUserByEmail buscavam com ".ilike()" (o "%"
--    do LIKE do Postgres não é escapado) — combinado com o item 1,
--    alguém podia digitar "%" no campo de e-mail e ir testando padrões
--    pra enumerar contas cadastradas aos poucos. A função
--    find_profile_by_email() abaixo faz a busca com privilégio elevado
--    só internamente, só por e-mail EXATO (sem curinga), devolvendo só
--    id+nome — nunca a tabela inteira.
--
-- 3) Bloquear alguém (blocked_users) só filtrava a pessoa da SUA
--    própria lista — não impedia a pessoa bloqueada de continuar
--    mandando mensagem/nudge pra você por baixo dos panos (chamando a
--    API direto, sem passar pela interface). Os gatilhos abaixo
--    recusam esse insert no banco de dados, não só escondem na tela.
-- ============================================================

-- ------------------------------------------------------------
-- 1) profiles: só o próprio perfil + quem é contato/bloqueado
-- ------------------------------------------------------------
drop policy if exists "Perfis são visíveis para usuários autenticados" on public.profiles;
drop policy if exists "Perfis visíveis: o próprio, contatos ou bloqueados" on public.profiles;
create policy "Perfis visíveis: o próprio, contatos ou bloqueados"
  on public.profiles for select
  to authenticated
  using (
    auth.uid() = id
    or exists (
      select 1 from public.contacts
      where contacts.owner_id = auth.uid() and contacts.contact_id = profiles.id
    )
    or exists (
      select 1 from public.blocked_users
      where blocked_users.owner_id = auth.uid() and blocked_users.blocked_id = profiles.id
    )
  );

-- ------------------------------------------------------------
-- 2) Busca por e-mail exato, sem expor a tabela toda nem aceitar
--    curinga de LIKE — usada por "Adicionar contato" e "Bloquear".
-- ------------------------------------------------------------
create or replace function public.find_profile_by_email(target_email text)
returns table(id uuid, display_name text)
language sql
security definer
set search_path = public
stable
as $$
  select p.id, p.display_name
  from public.profiles p
  where lower(p.email) = lower(trim(target_email))
  limit 1;
$$;

grant execute on function public.find_profile_by_email(text) to authenticated;

-- ------------------------------------------------------------
-- 3) Mensagens/nudges: recusa se quem está mandando foi bloqueado
--    por quem ia receber (o bloqueio passa a valer de verdade no
--    banco, não só escondendo o contato na lista).
-- ------------------------------------------------------------
drop policy if exists "Enviar mensagens como remetente" on public.messages;
create policy "Enviar mensagens como remetente"
  on public.messages for insert
  to authenticated
  with check (
    auth.uid() = sender_id
    and not exists (
      select 1 from public.blocked_users
      where blocked_users.owner_id = receiver_id and blocked_users.blocked_id = auth.uid()
    )
  );

drop policy if exists "Enviar nudge como remetente" on public.nudge_events;
create policy "Enviar nudge como remetente"
  on public.nudge_events for insert
  to authenticated
  with check (
    auth.uid() = sender_id
    and not exists (
      select 1 from public.blocked_users
      where blocked_users.owner_id = receiver_id and blocked_users.blocked_id = auth.uid()
    )
  );

-- ------------------------------------------------------------
-- 4) Buckets de imagem (avatars/scenes): limite de tamanho e tipo
--    aceito no PRÓPRIO Storage, não só na conferência feita no
--    navegador (que dá pra pular chamando a API direto).
-- ------------------------------------------------------------
update storage.buckets
set file_size_limit = 8388608, -- 8 MB (o app já comprime antes de enviar, ver dashboard.js)
    allowed_mime_types = array['image/png','image/jpeg','image/webp','image/gif']
where id in ('avatars', 'scenes');

-- ============================================================
-- Fim. 🎉
-- ============================================================
