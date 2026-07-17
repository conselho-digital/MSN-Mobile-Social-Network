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

  // Reenvia o e-mail de confirmação de cadastro. Usado quando o login
  // falha e a causa pode ser conta ainda não confirmada — o Supabase
  // devolve "Invalid login credentials" tanto pra senha errada quanto
  // pra e-mail não confirmado (não dá pra diferenciar só pela resposta
  // do login), então oferecemos o reenvio como ação à parte.
  async function resendConfirmation(email) {
    if (!isConfigured()) return;
    const { error } = await client.auth.resend({ type: "signup", email });
    if (error) throw error;
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

    const { error } = await client.storage
      .from("avatars")
      .upload(path, file, { upsert: true, contentType: file.type || "image/png" });
    if (error) throw error;

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

    const { error } = await client.storage
      .from("scenes")
      .upload(path, file, { upsert: true, contentType: file.type || "image/jpeg" });
    if (error) throw error;

    const { data: pub } = client.storage.from("scenes").getPublicUrl(path);
    const url = pub.publicUrl;
    return url;
  }

  /* ---------- Mensagens ---------- */
  // Histórico entre eu e um contato (as duas direções), mais antigas
  // primeiro. "content" é limitado a 2000 caracteres (ver schema.sql) —
  // por enquanto só texto, sem imagem/gif/anexo.
  async function getMessages(contactId) {
    if (!isConfigured()) return demoMessages(contactId);
    const { data: { user } } = await client.auth.getUser();
    if (!user) return [];
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
      .from("contacts").select("contact_id, is_favorite").eq("owner_id", user.id);
    if (error) throw error;
    const ids = (rows || []).map((r) => r.contact_id);
    if (!ids.length) return [];
    // is_favorite mora na linha de "contacts" (marcação própria de cada
    // dono sobre o contato), não em "profiles" — junta na mão aqui.
    const favMap = new Map((rows || []).map((r) => [r.contact_id, r.is_favorite]));
    const { data: profs, error: e2 } = await client
      .from("profiles").select("*").in("id", ids);
    if (e2) throw e2;
    return (profs || []).map((p) => ({ ...p, is_favorite: favMap.get(p.id) || false }));
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

  // Adiciona um contato buscando pelo e-mail (identidade do Passport
  // clássico do MSN).
  async function addContactByEmail(email) {
    if (!isConfigured()) return { ok: true, demo: true };
    const { data: { user } } = await client.auth.getUser();
    if (!user) throw new Error("Sessão expirada. Entre novamente.");

    const { data: found, error } = await client
      .from("profiles").select("id, display_name, email")
      .ilike("email", email.trim()).limit(1);
    if (error) throw error;
    if (!found || !found.length) throw new Error("Nenhum contato encontrado com esse e-mail.");
    if (found[0].id === user.id) throw new Error("Você não pode adicionar a si mesmo.");

    const { error: insErr } = await client
      .from("contacts").insert({ owner_id: user.id, contact_id: found[0].id });
    if (insErr && !/duplicate|unique/i.test(insErr.message)) throw insErr;
    return { ok: true, name: found[0].display_name };
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

    const { data: found, error } = await client
      .from("profiles").select("id, display_name, email")
      .ilike("email", email.trim()).limit(1);
    if (error) throw error;
    if (!found || !found.length) throw new Error("Nenhuma pessoa encontrada com esse e-mail.");
    if (found[0].id === user.id) throw new Error("Você não pode bloquear a si mesmo.");

    const { error: insErr } = await client
      .from("blocked_users").insert({ owner_id: user.id, blocked_id: found[0].id });
    if (insErr && !/duplicate|unique/i.test(insErr.message)) throw insErr;
    return { ok: true, name: found[0].display_name };
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
    init, isConfigured, signIn, signUp, getSession, signOut, resendConfirmation,
    getMyProfile, updateMyProfile, updateEmail, updatePassword, deleteMyAccount,
    getContacts, addContactByEmail, setFavorite,
    subscribeContacts, unsubscribeContacts,
    createGroup, getGroups,
    getBlockedUsers, blockUserByEmail, unblockUser,
    getMessages, sendMessage, subscribeMessages, unsubscribeMessages,
    sendNudge, subscribeNudges, unsubscribeNudges,
    uploadAvatar,
    uploadSceneImage,
    getClient: () => client,
  };
})();
