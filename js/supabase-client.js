/* ============================================================
   supabase-client.js
   Inicialização do Supabase e chamadas de autenticação.
   ------------------------------------------------------------
   👉 Preencha SUPABASE_URL e SUPABASE_ANON_KEY com as credenciais
      do seu projeto (Supabase > Project Settings > API).
      Enquanto não forem preenchidas, o app roda em "modo demo"
      e apenas simula o login (sem persistência).
   ============================================================ */

const SUPABASE_URL = "https://wxivxityfqrmbpjgiccb.supabase.co";
// Chave "anon public" — segura para uso no navegador (protegida por RLS).
// NUNCA coloque aqui a chave "service_role": ela ignora o RLS e daria
// acesso total ao banco para qualquer pessoa que abrir o código-fonte.
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind4aXZ4aXR5ZnFybWJwamdpY2NiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQwNDAzNDYsImV4cCI6MjA5OTYxNjM0Nn0.sHONk51I-_gRzZMHXjL5KhiIxFNxa3U3B-7Jv2tXsG0";

const MSNSupabase = (() => {
  let client = null;

  const isConfigured = () =>
    Boolean(SUPABASE_URL && SUPABASE_ANON_KEY && window.supabase);

  function init() {
    if (isConfigured()) {
      client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    }
    return client;
  }

  // Reenvia em caso de falha de REDE (não de erro de negócio, tipo
  // "e-mail já cadastrado") — o upload de foto/cenário costuma falhar
  // sozinho de vez em quando numa conexão de celular instável ("Failed
  // to fetch"), mesmo com o arquivo/permissões corretos; tentar de novo
  // sozinho resolve a maioria dos casos sem precisar que a pessoa clique
  // em enviar de novo. Espera crescente entre tentativas (300ms, depois
  // 900ms) pra dar tempo da conexão se recuperar.
  async function withRetry(fn, attempts = 3) {
    let lastErr;
    for (let i = 0; i < attempts; i++) {
      try {
        return await fn();
      } catch (err) {
        lastErr = err;
        const isNetworkError = err instanceof TypeError || /fetch/i.test(err.message || "");
        if (!isNetworkError || i === attempts - 1) throw err;
        await new Promise((resolve) => setTimeout(resolve, 300 * Math.pow(3, i)));
      }
    }
    throw lastErr;
  }

  // "Failed to fetch" (e outras TypeError de rede) é a mensagem crua do
  // próprio navegador quando o fetch nem chega a completar — não diz
  // nada útil pra quem está usando o app. Troca por uma mensagem em
  // português que explica o que realmente aconteceu.
  function friendlyError(err, fallback) {
    const isNetworkError = err instanceof TypeError || /fetch/i.test(err.message || "");
    if (isNetworkError) return "Não foi possível conectar. Verifique sua internet e tente novamente.";
    return err.message || fallback;
  }

  /* ---------- Autenticação ---------- */
  async function signIn(email, password) {
    if (!isConfigured()) {
      return demoAuth(email, password);
    }
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  }

  async function signUp(email, password, displayName, birthdate) {
    if (!isConfigured()) {
      return demoAuth(email, password);
    }
    const { data, error } = await client.auth.signUp({
      email,
      password,
      options: {
        data: { display_name: displayName, birthdate: birthdate || null },
        // Sem isso, o Supabase usa o "Site URL" configurado no painel pra
        // redirecionar depois de confirmar o e-mail — se aquele campo
        // estiver com o domínio errado (ex.: sem o caminho do repositório
        // no GitHub Pages), o link do e-mail cai numa página 404. Manda a
        // própria URL de onde o cadastro está rodando, então o redirect
        // sempre volta pro app de verdade.
        emailRedirectTo: window.location.href,
      },
    });
    if (error) throw error;
    return data;
  }

  async function getSession() {
    if (!isConfigured()) return null;
    const { data } = await client.auth.getSession();
    return data.session;
  }

  async function signOut() {
    if (isConfigured()) await client.auth.signOut();
  }

  /* ---------- Perfil ---------- */
  async function getMyProfile() {
    if (!isConfigured()) return demoProfile();
    const { data: { user } } = await client.auth.getUser();
    if (!user) throw new Error("Sessão expirada. Entre novamente.");

    let { data, error } = await client
      .from("profiles").select("*").eq("id", user.id).maybeSingle();
    if (error) throw error;

    // Se o gatilho não criou o perfil, cria agora a partir dos metadados.
    if (!data) {
      const meta = user.user_metadata || {};
      const insert = {
        id: user.id,
        display_name: meta.display_name || (user.email ? user.email.split("@")[0] : "Novo usuário"),
        sub_nick: meta.sub_nick || "",
        status: "online",
        email: user.email || null,
      };
      if (meta.birthdate) insert.birthdate = meta.birthdate;
      const { data: created, error: cerr } = await client
        .from("profiles").insert(insert).select().single();
      if (cerr) throw cerr;
      data = created;
    }
    return data;
  }

  async function updateMyProfile(patch) {
    if (!isConfigured()) return { ...demoProfile(), ...patch };
    const { data: { user } } = await client.auth.getUser();
    if (!user) throw new Error("Sessão expirada. Entre novamente.");
    const { data, error } = await client
      .from("profiles").update(patch).eq("id", user.id).select().single();
    if (error) throw error;
    return data;
  }

  /* ---------- Conta (Opções > Segurança) ---------- */
  // O Supabase manda um e-mail de confirmação pro endereço novo — a
  // troca só vale de verdade depois que a pessoa confirmar por lá.
  async function updateEmail(newEmail) {
    if (!isConfigured()) return;
    const { error } = await client.auth.updateUser({ email: newEmail });
    if (error) throw error;
  }

  async function updatePassword(newPassword) {
    if (!isConfigured()) return;
    const { error } = await client.auth.updateUser({ password: newPassword });
    if (error) throw error;
  }

  // Apagar a própria conta exige privilégio elevado sobre auth.users,
  // que o app NUNCA deve ter direto no navegador (a service_role key
  // ignora RLS). Em vez disso chama uma função no banco que roda com
  // privilégio elevado só internamente e só apaga quem chamou (ver
  // supabase/account_management.sql).
  async function deleteMyAccount() {
    if (!isConfigured()) return;
    const { error } = await client.rpc("delete_my_account");
    if (error) throw error;
  }

  /* ---------- Foto de exibição (avatar) ---------- */
  async function uploadAvatar(file) {
    if (!isConfigured()) throw new Error("Configure o Supabase para enviar fotos.");
    const { data: { user } } = await client.auth.getUser();
    if (!user) throw new Error("Sessão expirada. Entre novamente.");

    const ext = (file.name.split(".").pop() || "png").toLowerCase();
    const path = user.id + "/avatar_" + Date.now() + "." + ext;

    await withRetry(async () => {
      const { error } = await client.storage
        .from("avatars")
        .upload(path, file, { upsert: true, contentType: file.type || "image/png" });
      if (error) throw error;
    });

    const { data: pub } = client.storage.from("avatars").getPublicUrl(path);
    const url = pub.publicUrl;
    await client.from("profiles").update({ avatar_url: url }).eq("id", user.id);
    return url;
  }

  /* ---------- Cenário customizado (botão "Procurar...") ---------- */
  async function uploadSceneImage(file) {
    if (!isConfigured()) throw new Error("Configure o Supabase para enviar imagens.");
    const { data: { user } } = await client.auth.getUser();
    if (!user) throw new Error("Sessão expirada. Entre novamente.");

    const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
    const path = user.id + "/scene_" + Date.now() + "." + ext;

    await withRetry(async () => {
      const { error } = await client.storage
        .from("scenes")
        .upload(path, file, { upsert: true, contentType: file.type || "image/jpeg" });
      if (error) throw error;
    });

    const { data: pub } = client.storage.from("scenes").getPublicUrl(path);
    const url = pub.publicUrl;
    return url;
  }

  /* ---------- Mensagens ---------- */
  // Formato bruto de um uuid do Postgres — só pra validar antes de
  // colar o valor dentro da string de filtro do ".or()" abaixo (ver
  // comentário logo ali). Não aceita nada fora desse formato.
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  // Histórico entre eu e um contato (as duas direções), mais antigas
  // primeiro. "content" é limitado a 2000 caracteres (ver schema.sql) —
  // por enquanto só texto, sem imagem/gif/anexo.
  async function getMessages(contactId) {
    if (!isConfigured()) return demoMessages(contactId);
    const { data: { user } } = await client.auth.getUser();
    if (!user) return [];
    // contactId chega como string vinda do estado do app (não é um
    // parâmetro tratado pelo PostgREST, é colado direto na sintaxe do
    // filtro ".or()") — confere que é mesmo um uuid antes de montar a
    // string, pra ninguém conseguir injetar vírgula/parênteses e
    // alterar o filtro. A proteção de verdade continua sendo a RLS da
    // tabela (só vejo o que sou remetente/destinatário de qualquer
    // forma), isso aqui é só reforço.
    if (!UUID_RE.test(String(contactId))) return [];
    const { data, error } = await client
      .from("messages")
      .select("*")
      .or(
        "and(sender_id.eq." + user.id + ",receiver_id.eq." + contactId + ")," +
        "and(sender_id.eq." + contactId + ",receiver_id.eq." + user.id + ")"
      )
      .order("created_at", { ascending: true })
      .limit(200);
    if (error) throw error;
    return data || [];
  }

  async function sendMessage(contactId, content) {
    if (!isConfigured()) return { ...demoMessage(content), demo: true };
    const { data: { user } } = await client.auth.getUser();
    if (!user) throw new Error("Sessão expirada. Entre novamente.");
    const { data, error } = await client
      .from("messages")
      .insert({ sender_id: user.id, receiver_id: contactId, content })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  // Tempo real: novas mensagens ENVIADAS PRA MIM por qualquer pessoa —
  // quem chamou filtra pelo contato da conversa aberta (evita assinar
  // um canal por contato).
  let messagesChannel = null;
  function subscribeMessages(onInsert) {
    if (!isConfigured()) return null;
    unsubscribeMessages();
    messagesChannel = client
      .channel("messages-changes")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        (payload) => onInsert(payload.new)
      )
      .subscribe();
    return messagesChannel;
  }
  function unsubscribeMessages() {
    if (messagesChannel) {
      client.removeChannel(messagesChannel);
      messagesChannel = null;
    }
  }

  /* ---------- Presença em tempo real ---------- */
  // profiles.status é a ESCOLHA da pessoa (Disponível/Ocupado/Ausente)
  // — não muda sozinha quando o aparelho perde a conexão de verdade
  // (internet caiu, aba fechou, deslogou). Um canal de "presença" do
  // Supabase Realtime resolve isso: cada aparelho/aba conectado
  // "marca presença" agrupada pela própria conta (key = user.id), e o
  // servidor detecta sozinho quando a conexão cai (sem precisar que o
  // cliente avise nada — funciona até se a internet cair de vez, ver
  // dashboard.js). Só volta a "offline" quando NENHUM aparelho/aba
  // daquela conta estiver mais conectado.
  let presenceChannel = null;
  async function subscribePresence(onSync) {
    if (!isConfigured()) return null;
    unsubscribePresence();
    const { data: { user } } = await client.auth.getUser();
    if (!user) return null;
    presenceChannel = client.channel("online-users", {
      config: { presence: { key: user.id } },
    });
    presenceChannel
      .on("presence", { event: "sync" }, () => {
        // presenceState() agrupa por key (o id de quem está
        // conectado) — várias abas/aparelhos da mesma conta caem na
        // mesma chave, então ela some da lista só quando a última
        // conexão encerrar.
        onSync(new Set(Object.keys(presenceChannel.presenceState())));
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") presenceChannel.track({ online_at: new Date().toISOString() });
      });
    return presenceChannel;
  }
  function unsubscribePresence() {
    if (presenceChannel) {
      client.removeChannel(presenceChannel);
      presenceChannel = null;
    }
  }

  /* ---------- Chamar a atenção (nudge) ---------- */
  async function sendNudge(contactId) {
    if (!isConfigured()) return { ok: true, demo: true };
    const { data: { user } } = await client.auth.getUser();
    if (!user) throw new Error("Sessão expirada. Entre novamente.");
    const { error } = await client
      .from("nudge_events")
      .insert({ sender_id: user.id, receiver_id: contactId });
    if (error) throw error;
    return { ok: true };
  }

  let nudgeChannel = null;
  function subscribeNudges(onNudge) {
    if (!isConfigured()) return null;
    unsubscribeNudges();
    nudgeChannel = client
      .channel("nudge-changes")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "nudge_events" },
        (payload) => onNudge(payload.new)
      )
      .subscribe();
    return nudgeChannel;
  }
  function unsubscribeNudges() {
    if (nudgeChannel) {
      client.removeChannel(nudgeChannel);
      nudgeChannel = null;
    }
  }

  /* ---------- Contatos ---------- */
  async function getContacts() {
    if (!isConfigured()) return demoContacts();
    const { data: { user } } = await client.auth.getUser();
    if (!user) return [];
    const { data: rows, error } = await client
      .from("contacts").select("contact_id, is_favorite, is_muted, appear_offline").eq("owner_id", user.id);
    if (error) throw error;
    const ids = (rows || []).map((r) => r.contact_id);
    if (!ids.length) return [];
    // is_favorite/is_muted/appear_offline moram na linha de "contacts"
    // (marcação própria de cada dono sobre o contato), não em
    // "profiles" — junta na mão aqui (ver supabase/contact_settings.sql).
    const ownMap = new Map((rows || []).map((r) => [r.contact_id, r]));
    // get_contact_profiles() é igual a ler "profiles" direto, só que
    // esconde foto/cenário/cor do tema de quem me bloqueou (ver
    // supabase/contact_settings.sql) — cai pro select direto se essa
    // migração ainda não tiver rodado nesse projeto Supabase.
    let profs;
    const rpcResult = await client.rpc("get_contact_profiles", { target_ids: ids });
    if (!rpcResult.error) {
      profs = rpcResult.data;
    } else {
      const { data, error: e2 } = await client.from("profiles").select("*").in("id", ids);
      if (e2) throw e2;
      profs = data;
    }
    return (profs || []).map((p) => {
      const own = ownMap.get(p.id) || {};
      return { ...p, is_favorite: own.is_favorite || false, is_muted: own.is_muted || false, appear_offline: own.appear_offline || false };
    });
  }

  // Exclui um contato da MINHA lista (não bloqueia, não apaga o
  // histórico de mensagens — só a linha de "amizade" em si, igual ao
  // "Excluir contato" do cliente clássico).
  async function removeContact(contactId) {
    if (!isConfigured()) return { ok: true, demo: true };
    const { data: { user } } = await client.auth.getUser();
    if (!user) throw new Error("Sessão expirada. Entre novamente.");
    const { error } = await client
      .from("contacts")
      .delete()
      .eq("owner_id", user.id)
      .eq("contact_id", contactId);
    if (error) throw error;
    return { ok: true };
  }

  // Marca/desmarca um contato como favorito (ver supabase/favorites.sql).
  async function setFavorite(contactId, isFavorite) {
    if (!isConfigured()) return { ok: true, demo: true };
    const { data: { user } } = await client.auth.getUser();
    if (!user) throw new Error("Sessão expirada. Entre novamente.");
    const { error } = await client
      .from("contacts")
      .update({ is_favorite: isFavorite })
      .eq("owner_id", user.id)
      .eq("contact_id", contactId);
    if (error) throw error;
    return { ok: true };
  }

  // Silencia/reativa notificações desse contato (mensagens, "ficou
  // online" etc. — decidido no cliente, ver dashboard.js).
  async function setContactMuted(contactId, muted) {
    if (!isConfigured()) return { ok: true, demo: true };
    const { data: { user } } = await client.auth.getUser();
    if (!user) throw new Error("Sessão expirada. Entre novamente.");
    const { error } = await client
      .from("contacts")
      .update({ is_muted: muted })
      .eq("owner_id", user.id)
      .eq("contact_id", contactId);
    if (error) throw error;
    return { ok: true };
  }

  // "Aparecer offline" só pra esse contato específico — meu status de
  // verdade continua igual pros outros (ver
  // get_forced_offline_contacts em supabase/contact_settings.sql).
  async function setAppearOffline(contactId, appearOffline) {
    if (!isConfigured()) return { ok: true, demo: true };
    const { data: { user } } = await client.auth.getUser();
    if (!user) throw new Error("Sessão expirada. Entre novamente.");
    const { error } = await client
      .from("contacts")
      .update({ appear_offline: appearOffline })
      .eq("owner_id", user.id)
      .eq("contact_id", contactId);
    if (error) throw error;
    return { ok: true };
  }

  // Pra cada contato meu, diz se eu devo aparecer OFFLINE pra ele —
  // porque ele me bloqueou, ou porque eu escolhi aparecer offline só
  // pra ele (ver get_forced_offline_contacts em
  // supabase/contact_settings.sql). Uma consulta só pra todos os
  // contatos, em vez de perguntar um por um.
  async function getForcedOfflineContacts() {
    if (!isConfigured()) return [];
    const { data, error } = await client.rpc("get_forced_offline_contacts");
    if (error) throw error;
    return data || [];
  }

  /* ---------- Plano de fundo pessoal por conversa ---------- */
  // Ver supabase/chat_backgrounds.sql — uma linha por (eu, contato),
  // só eu leio/escrevo a minha (RLS). Sem linha pra um contato = usa a
  // cor do tema dele (decidido no cliente, ver dashboard.js).
  async function getChatBackgrounds() {
    if (!isConfigured()) return [];
    const { data: { user } } = await client.auth.getUser();
    if (!user) return [];
    const { data, error } = await client
      .from("chat_backgrounds")
      .select("contact_id, scene, color_scheme, scene_image_url")
      .eq("owner_id", user.id);
    if (error) throw error;
    return data || [];
  }

  // scene falsy = apaga a linha (volta a usar a cor do tema do contato).
  async function setChatBackground(contactId, scene, colorScheme, sceneImageUrl) {
    if (!isConfigured()) return { ok: true, demo: true };
    const { data: { user } } = await client.auth.getUser();
    if (!user) throw new Error("Sessão expirada. Entre novamente.");
    if (!scene) {
      const { error } = await client
        .from("chat_backgrounds")
        .delete()
        .eq("owner_id", user.id)
        .eq("contact_id", contactId);
      if (error) throw error;
      return { ok: true };
    }
    const { error } = await client
      .from("chat_backgrounds")
      .upsert({
        owner_id: user.id,
        contact_id: contactId,
        scene,
        color_scheme: colorScheme || null,
        scene_image_url: scene === "custom" ? (sceneImageUrl || null) : null,
        updated_at: new Date().toISOString(),
      }, { onConflict: "owner_id,contact_id" });
    if (error) throw error;
    return { ok: true };
  }

  // Escuta mudanças em profiles (status, nome, mensagem pessoal, foto)
  // em tempo real, via Supabase Realtime — assim a lista de contatos
  // (e a cor da moldura) atualiza sozinha quando alguém troca de
  // status, sem precisar recarregar a página. onUpdate recebe a linha
  // inteira atualizada (payload.new); quem chamou decide o que fazer
  // com ela (dashboard.js filtra pelos ids que já são contatos).
  let contactsChannel = null;
  function subscribeContacts(onUpdate) {
    if (!isConfigured()) return null;
    unsubscribeContacts();
    contactsChannel = client
      .channel("profiles-changes")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "profiles" },
        (payload) => onUpdate(payload.new)
      )
      .subscribe();
    return contactsChannel;
  }
  function unsubscribeContacts() {
    if (contactsChannel) {
      client.removeChannel(contactsChannel);
      contactsChannel = null;
    }
  }

  // Acha o id de alguém pelo e-mail EXATO (sem curinga de LIKE), via
  // uma função no banco com privilégio elevado só internamente (ver
  // find_profile_by_email em supabase/security_hardening.sql) — não lê
  // a tabela profiles direto, pra não expor o e-mail/nome de quem não
  // é contato nem devolver mais de uma linha por vez.
  async function findProfileByEmail(email) {
    const { data, error } = await client.rpc("find_profile_by_email", { target_email: email.trim() });
    if (error) throw error;
    return (data && data[0]) || null;
  }

  // Adiciona um contato buscando pelo e-mail (identidade do Passport
  // clássico do MSN).
  async function addContactByEmail(email) {
    if (!isConfigured()) return { ok: true, demo: true };
    const { data: { user } } = await client.auth.getUser();
    if (!user) throw new Error("Sessão expirada. Entre novamente.");

    const found = await findProfileByEmail(email);
    if (!found) throw new Error("Nenhum contato encontrado com esse e-mail.");
    if (found.id === user.id) throw new Error("Você não pode adicionar a si mesmo.");

    const { error: insErr } = await client
      .from("contacts").insert({ owner_id: user.id, contact_id: found.id });
    if (insErr && !/duplicate|unique/i.test(insErr.message)) throw insErr;
    return { ok: true, name: found.display_name };
  }

  /* ---------- Pessoas bloqueadas (ver supabase/blocked_users.sql) ---------- */
  async function getBlockedUsers() {
    if (!isConfigured()) return demoBlockedUsers();
    const { data: { user } } = await client.auth.getUser();
    if (!user) return [];
    const { data: rows, error } = await client
      .from("blocked_users").select("blocked_id").eq("owner_id", user.id);
    if (error) throw error;
    const ids = (rows || []).map((r) => r.blocked_id);
    if (!ids.length) return [];
    const { data: profs, error: e2 } = await client
      .from("profiles").select("id, display_name, email").in("id", ids);
    if (e2) throw e2;
    return profs || [];
  }

  async function blockUserByEmail(email) {
    if (!isConfigured()) return { ok: true, demo: true };
    const { data: { user } } = await client.auth.getUser();
    if (!user) throw new Error("Sessão expirada. Entre novamente.");

    const found = await findProfileByEmail(email);
    if (!found) throw new Error("Nenhuma pessoa encontrada com esse e-mail.");
    if (found.id === user.id) throw new Error("Você não pode bloquear a si mesmo.");

    const { error: insErr } = await client
      .from("blocked_users").insert({ owner_id: user.id, blocked_id: found.id });
    if (insErr && !/duplicate|unique/i.test(insErr.message)) throw insErr;
    return { ok: true, name: found.display_name };
  }

  async function unblockUser(blockedId) {
    if (!isConfigured()) return { ok: true, demo: true };
    const { data: { user } } = await client.auth.getUser();
    if (!user) throw new Error("Sessão expirada. Entre novamente.");
    const { error } = await client
      .from("blocked_users").delete()
      .eq("owner_id", user.id).eq("blocked_id", blockedId);
    if (error) throw error;
    return { ok: true };
  }

  /* ---------- Grupos ---------- */
  async function createGroup(name, memberIds) {
    if (!isConfigured()) return { ok: true, demo: true };
    const { data: { user } } = await client.auth.getUser();
    if (!user) throw new Error("Sessão expirada. Entre novamente.");

    const { error } = await client
      .from("groups")
      .insert({ owner_id: user.id, name: name.trim(), member_ids: memberIds || [] });
    if (error) throw error;
    return { ok: true };
  }

  // Grupos criados pela própria pessoa (ver "Criar um grupo...").
  async function getGroups() {
    if (!isConfigured()) return demoGroups();
    const { data: { user } } = await client.auth.getUser();
    if (!user) return [];
    const { data: rows, error } = await client
      .from("groups").select("id, name, member_ids").eq("owner_id", user.id)
      .order("created_at", { ascending: true });
    if (error) throw error;
    return rows || [];
  }

  /* ---------- Dados de demonstração ---------- */
  function demoProfile() {
    return { id: "demo", display_name: "Você", sub_nick: "", status: "online" };
  }
  function demoContacts() {
    return [
      { id: "d1", display_name: "Ana Clara ♥", email: "ana.clara@escargot.chat", sub_nick: "só vim ver as novidades", status: "online", is_favorite: true },
      { id: "d2", display_name: "João Pedro", email: "joao.pedro@escargot.chat", sub_nick: "ocupado estudando", status: "busy", is_favorite: false },
      { id: "d3", display_name: "mayara", email: "mayara@escargot.chat", sub_nick: "", status: "offline", is_favorite: false },
    ];
  }
  function demoGroups() {
    return [{ id: "g1", name: "Amigos da faculdade", member_ids: ["d2"] }];
  }
  function demoBlockedUsers() {
    return [];
  }
  const demoMessageStore = {};
  function demoMessages(contactId) {
    return demoMessageStore[contactId] || [];
  }
  function demoMessage(content) {
    const msg = {
      id: "m" + Date.now(),
      sender_id: "demo",
      receiver_id: "demo-contact",
      content,
      created_at: new Date().toISOString(),
    };
    return msg;
  }

  /* ---------- Modo demo (sem credenciais) ---------- */
  function demoAuth(email, password) {
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        if (!email || !password) {
          reject(new Error("Preencha e-mail e senha."));
        } else {
          resolve({
            user: { email, id: "demo-" + Date.now() },
            demo: true,
          });
        }
      }, 900);
    });
  }

  return {
    init, isConfigured, signIn, signUp, getSession, signOut,
    getMyProfile, updateMyProfile, updateEmail, updatePassword, deleteMyAccount,
    getContacts, addContactByEmail, setFavorite, removeContact,
    setContactMuted, setAppearOffline, getForcedOfflineContacts,
    getChatBackgrounds, setChatBackground,
    subscribeContacts, unsubscribeContacts,
    createGroup, getGroups,
    getBlockedUsers, blockUserByEmail, unblockUser,
    getMessages, sendMessage, subscribeMessages, unsubscribeMessages,
    subscribePresence, unsubscribePresence,
    sendNudge, subscribeNudges, unsubscribeNudges,
    uploadAvatar,
    uploadSceneImage,
    friendlyError,
    getClient: () => client,
  };
})();
