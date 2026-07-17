-- ============================================================
-- MSN - Mobile Social Network — Plano de fundo pessoal por conversa
-- ------------------------------------------------------------
-- Como usar: cole no SQL Editor do Supabase e clique em "Run". É
-- idempotente (pode rodar de novo com segurança).
--
-- Contexto: o "Plano de Fundo" (atrás do texto das mensagens) é uma
-- escolha pessoal, por contato — só quem escolheu vê, só naquela
-- conversa. Até agora isso ficava só no localStorage do aparelho (não
-- acompanhava a conta se a pessoa trocasse de celular/navegador).
-- Esta tabela guarda a mesma informação no banco, então ela sincroniza
-- entre aparelhos (o app já lê daqui ao abrir o Dashboard e escreve
-- aqui sempre que a escolha muda — ver getChatBackgrounds/
-- setChatBackground em supabase-client.js).
--
-- Sem linha pra um contato = usa a cor do tema dele (decidido no
-- cliente, não precisa de nada especial aqui).
-- ============================================================

create table if not exists public.chat_backgrounds (
  owner_id uuid not null references auth.users(id) on delete cascade,
  contact_id uuid not null references auth.users(id) on delete cascade,
  -- Mesmo vocabulário do cenário da conta (profiles.scene): um id do
  -- catálogo (assets/scenes/*.webp) ou "custom" (aí scene_image_url
  -- guarda a foto enviada pela própria pessoa via "Procurar...").
  scene text,
  color_scheme text,
  scene_image_url text,
  updated_at timestamptz not null default now(),
  primary key (owner_id, contact_id)
);

alter table public.chat_backgrounds enable row level security;

-- Totalmente pessoal: cada um só enxerga e mexe nas próprias escolhas
-- (diferente de "contacts", aqui não tem espelhamento nenhum — o
-- plano de fundo que eu escolho pra falar com a Maria não aparece pra
-- ela nem pra ninguém mais).
drop policy if exists "chat_backgrounds_select_own" on public.chat_backgrounds;
create policy "chat_backgrounds_select_own" on public.chat_backgrounds
  for select using (auth.uid() = owner_id);

drop policy if exists "chat_backgrounds_insert_own" on public.chat_backgrounds;
create policy "chat_backgrounds_insert_own" on public.chat_backgrounds
  for insert with check (auth.uid() = owner_id);

drop policy if exists "chat_backgrounds_update_own" on public.chat_backgrounds;
create policy "chat_backgrounds_update_own" on public.chat_backgrounds
  for update using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

drop policy if exists "chat_backgrounds_delete_own" on public.chat_backgrounds;
create policy "chat_backgrounds_delete_own" on public.chat_backgrounds
  for delete using (auth.uid() = owner_id);

-- ============================================================
-- Fim. 🎉
-- ============================================================
