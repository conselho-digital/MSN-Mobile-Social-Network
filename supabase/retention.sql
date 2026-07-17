-- ============================================================
-- MSN - Mobile Social Network — Retenção de dados
-- ------------------------------------------------------------
-- Como usar:
--   1. No painel do Supabase, vá em Database > Extensions e habilite
--      "pg_cron" (procure por "pg_cron" na lista e ligue) — só precisa
--      fazer isso uma vez.
--   2. Vá em "SQL Editor" > "New query", cole TODO este arquivo e
--      clique em "Run".
--
-- O que isso faz, rodando sozinho todo dia:
--   - Apaga mensagens de texto (public.messages) com mais de 6 meses.
--   - Apaga contas sem login há mais de 1 ano (quem nunca fez login
--     usa a data de criação da conta como referência). Isso também
--     apaga em cascata o perfil, mensagens, contatos etc. dessa
--     pessoa, já que essas tabelas referenciam profiles/auth.users
--     com ON DELETE CASCADE (ver schema.sql).
--
-- Este script é idempotente: pode ser executado novamente com
-- segurança (recria as funções e reagenda os jobs sem duplicar).
-- ============================================================

create extension if not exists pg_cron with schema extensions;

-- ------------------------------------------------------------
-- Mensagens com mais de 6 meses
-- ------------------------------------------------------------
create or replace function public.purge_old_messages()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.messages
  where created_at < now() - interval '6 months';
$$;

select cron.schedule(
  'purge-old-messages',
  '0 3 * * *', -- todo dia às 3h (horário do servidor, UTC)
  $$ select public.purge_old_messages(); $$
)
where not exists (
  select 1 from cron.job where jobname = 'purge-old-messages'
);

-- ------------------------------------------------------------
-- Contas sem login há mais de 1 ano
-- ------------------------------------------------------------
create or replace function public.purge_inactive_accounts()
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  delete from auth.users
  where coalesce(last_sign_in_at, created_at) < now() - interval '1 year';
end;
$$;

select cron.schedule(
  'purge-inactive-accounts',
  '0 4 * * *', -- todo dia às 4h (depois da limpeza de mensagens)
  $$ select public.purge_inactive_accounts(); $$
)
where not exists (
  select 1 from cron.job where jobname = 'purge-inactive-accounts'
);

-- ============================================================
-- Fim. 🎉
-- Pra conferir que os jobs foram criados: select * from cron.job;
-- Pra ver o histórico de execuções: select * from cron.job_run_details
-- order by start_time desc limit 20;
-- ============================================================
