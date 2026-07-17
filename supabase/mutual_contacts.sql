-- ============================================================
-- MSN - Mobile Social Network — Adicionar contato é mútuo
-- ------------------------------------------------------------
-- Como usar: cole no SQL Editor do Supabase e clique em "Run". É
-- idempotente (pode rodar de novo com segurança).
--
-- Contexto: quando a pessoa A adiciona a pessoa B (envia um e-mail e
-- vira contato dela), a política de RLS de public.contacts só deixa
-- cada cliente inserir linhas com owner_id = o próprio uid — então A
-- não consegue inserir direto, pelo navegador, uma linha na lista de
-- B (nem deveria, seria um jeito de qualquer pessoa se adicionar na
-- lista de qualquer outra). Por isso isso precisa ser um gatilho no
-- banco, rodando com privilégio elevado só internamente: sempre que
-- uma linha nova entra em contacts, espelha automaticamente a linha
-- contrária (B ganha A na lista dela também), sem precisar aceitar
-- nada — como pedido.
--
-- Não entra em loop: o próprio INSERT feito pelo gatilho passa pelo
-- "on conflict ... do nothing", e um INSERT ignorado por conflito não
-- dispara o gatilho de novo (comportamento padrão do Postgres) — ou
-- seja, no máximo 2 linhas são criadas (a original + o espelho).
-- ============================================================

create or replace function public.mirror_contact_addition()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.contacts (owner_id, contact_id)
  values (new.contact_id, new.owner_id)
  on conflict (owner_id, contact_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_contact_added_mirror on public.contacts;
create trigger on_contact_added_mirror
  after insert on public.contacts
  for each row execute function public.mirror_contact_addition();

-- ============================================================
-- Fim. 🎉
-- ============================================================
