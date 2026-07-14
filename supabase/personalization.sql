-- ============================================================
-- MSN - Mobile Social Network — Personalização
-- (foto de exibição + cenário do topo)
-- ------------------------------------------------------------
-- Rode este script no SQL Editor do Supabase DEPOIS do schema.sql.
-- É idempotente (pode rodar de novo com segurança).
-- ============================================================

-- 1) Coluna do cenário (fundo do cabeçalho do dashboard)
alter table public.profiles
  add column if not exists scene text default 'green';

-- 2) Bucket público para as fotos de exibição (avatars)
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

-- 3) Políticas de acesso ao bucket "avatars"
--    Leitura pública; cada usuário só escreve na sua própria pasta
--    (o caminho do arquivo começa com o id do usuário: "<uid>/...").

drop policy if exists "Avatars são públicos para leitura" on storage.objects;
create policy "Avatars são públicos para leitura"
  on storage.objects for select
  using (bucket_id = 'avatars');

drop policy if exists "Usuário envia o próprio avatar" on storage.objects;
create policy "Usuário envia o próprio avatar"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Usuário atualiza o próprio avatar" on storage.objects;
create policy "Usuário atualiza o próprio avatar"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Usuário remove o próprio avatar" on storage.objects;
create policy "Usuário remove o próprio avatar"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ============================================================
-- Fim. 🎉
-- ============================================================
