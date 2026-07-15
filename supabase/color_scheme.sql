-- ============================================================
-- MSN - Mobile Social Network — Esquema de cores (independente do cenário)
-- ------------------------------------------------------------
-- Rode este script no SQL Editor do Supabase. É idempotente (pode
-- rodar de novo com segurança).
--
-- Contexto: "profiles.scene" já guarda o CENÁRIO (a imagem/degradê do
-- topo). Esta coluna nova guarda o ESQUEMA DE CORES escolhido
-- separadamente (a cor que tinge a tela abaixo da busca), como no
-- diálogo clássico "Cenário" que tem as duas seções independentes.
--
-- Fica NULL até a pessoa escolher uma cor explicitamente; enquanto
-- for NULL, o app usa a cor pareada automaticamente ao cenário (como
-- já funciona hoje) — nada quebra para quem nunca abriu o seletor.
-- ============================================================

alter table public.profiles
  add column if not exists color_scheme text;

-- ============================================================
-- Fim. 🎉
-- ============================================================
