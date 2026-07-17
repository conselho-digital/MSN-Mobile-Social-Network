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
-- O que isso faz, rodando sozinho duas vezes por dia (meia-noite e
-- meio-dia, horário UTC):
--   - Apaga mensagens de texto (public.messages) com mais de 6 meses.
--   - Apaga contas sem login há mais de 1 ano (quem nunca fez login
--     usa a data de criação da conta como referência). Isso também
--     apaga em cascata o perfil, mensagens, contatos etc. dessa
--     pessoa, já que essas tabelas referenciam profiles/auth.users
--     com ON DELETE CASCADE (ver schema.sql).
--
-- Por que duas vezes por dia em vez de uma: o agendamento em si não
-- tem custo nenhum no Supabase (é só um gatilho de SQL na sua própria
-- base) — quem "pesa" é o tamanho de cada DELETE. Rodando com mais
-- frequência, cada limpeza apaga um lote menor (só o que venceu desde
-- a última vez) em vez de acumular um dia inteiro pra apagar de uma
-- vez só — mais leve por execução, não mais pesado, e ajuda a não
-- deixar a base crescer perto do limite do plano gratuito.
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

-- Remove um agendamento antigo (se este script já tinha sido rodado
-- antes com outro horário) pra sempre ficar só com o horário abaixo.
select cron.unschedule(jobid) from cron.job where jobname = 'purge-old-messages';

select cron.schedule(
  'purge-old-messages',
  '0 0,12 * * *', -- meia-noite e meio-dia (horário do servidor, UTC)
  $$ select public.purge_old_messages(); $$
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

select cron.unschedule(jobid) from cron.job where jobname = 'purge-inactive-accounts';

select cron.schedule(
  'purge-inactive-accounts',
  '15 0,12 * * *', -- 15min depois da limpeza de mensagens, pra não disputar lock nas mesmas tabelas ao mesmo tempo
  $$ select public.purge_inactive_accounts(); $$
);

-- ============================================================
-- Fim. 🎉
-- Pra conferir que os jobs foram criados: select * from cron.job;
-- Pra ver o histórico de execuções: select * from cron.job_run_details
-- order by start_time desc limit 20;
-- ============================================================
