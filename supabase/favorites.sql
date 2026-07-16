-- ============================================================
-- MSN - Mobile Social Network — Contatos favoritos
-- ------------------------------------------------------------
-- Rode este script no SQL Editor do Supabase. É idempotente (pode
-- rodar de novo com segurança).
--
-- Contexto: "Favoritos" é uma marcação PRÓPRIA de cada pessoa sobre um
-- contato dela (não é uma propriedade do contato em si) — por isso a
-- coluna fica na linha de public.contacts (owner_id + contact_id), não
-- em public.profiles. Fica false até a pessoa marcar um contato como
-- favorito pela primeira vez.
-- ============================================================

alter table public.contacts
  add column if not exists is_favorite boolean not null default false;

-- ============================================================
-- Fim. 🎉
-- ============================================================
