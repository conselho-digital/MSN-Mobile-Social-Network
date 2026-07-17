-- ============================================================
-- MSN - Mobile Social Network — Autoatendimento de conta
-- (aba Opções > Segurança: trocar e-mail, trocar senha, excluir conta)
-- ------------------------------------------------------------
-- Como usar: cole no SQL Editor do Supabase e clique em "Run". É
-- idempotente (pode rodar de novo com segurança).
--
-- Trocar e-mail e trocar senha usam supabase.auth.updateUser() direto
-- do navegador — não precisam de nada aqui.
--
-- Excluir conta é diferente: apagar de auth.users exige privilégio
-- elevado que o app NUNCA deve ter direto no navegador (a service_role
-- key ignora RLS e daria acesso total ao banco pra quem abrisse o
-- código-fonte). Em vez disso, esta função roda com privilégio elevado
-- só internamente (security definer) e só apaga a PRÓPRIA conta de
-- quem chamou (auth.uid()) — nunca a de outra pessoa. O app chama ela
-- via client.rpc("delete_my_account"), usando a chave "anon" normal.
--
-- Apagar de auth.users cascateia sozinho pra profiles, messages,
-- contacts, groups, blocked_users e nudge_events, porque todas essas
-- tabelas já referenciam profiles/auth.users com ON DELETE CASCADE
-- (ver schema.sql, blocked_users.sql).
-- ============================================================

create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  delete from auth.users where id = auth.uid();
end;
$$;

grant execute on function public.delete_my_account() to authenticated;

-- ============================================================
-- Fim. 🎉
-- ============================================================
