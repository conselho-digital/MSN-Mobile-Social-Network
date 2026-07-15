-- ============================================================
-- MSN - Mobile Social Network — Cenário customizado (upload da pessoa)
-- ------------------------------------------------------------
-- Rode este script no SQL Editor do Supabase. É idempotente (pode
-- rodar de novo com segurança). Depende do schema.sql já ter rodado.
--
-- Contexto: o botão "Procurar..." no seletor de cenário deixa a
-- pessoa enviar a PRÓPRIA imagem para usar como cenário, em vez de
-- escolher uma das opções prontas.
-- ============================================================

-- 1) Coluna com a URL da imagem de cenário customizada.
--    Quando profiles.scene = 'custom', esta é a imagem usada.
alter table public.profiles
  add column if not exists scene_image_url text;

-- 2) Bucket público para as imagens de cenário customizadas
insert into storage.buckets (id, name, public)
values ('scenes', 'scenes', true)
on conflict (id) do nothing;

-- 3) Políticas de acesso ao bucket "scenes"
--    Leitura pública; cada usuário só escreve na própria pasta
--    (o caminho do arquivo começa com o id do usuário: "<uid>/...").

drop policy if exists "Cenários são públicos para leitura" on storage.objects;
create policy "Cenários são públicos para leitura"
  on storage.objects for select
  using (bucket_id = 'scenes');

drop policy if exists "Usuário envia o próprio cenário" on storage.objects;
create policy "Usuário envia o próprio cenário"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'scenes'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Usuário atualiza o próprio cenário" on storage.objects;
create policy "Usuário atualiza o próprio cenário"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'scenes'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Usuário remove o próprio cenário" on storage.objects;
create policy "Usuário remove o próprio cenário"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'scenes'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ============================================================
-- Fim. 🎉
-- ============================================================
