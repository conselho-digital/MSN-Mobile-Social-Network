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
      options: { data: { display_name: displayName, birthdate: birthdate || null } },
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
    const { data, error } = await client
      .from("profiles").select("*").eq("id", user.id).single();
    if (error) throw error;
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

  /* ---------- Contatos ---------- */
  async function getContacts() {
    if (!isConfigured()) return demoContacts();
    const { data: { user } } = await client.auth.getUser();
    if (!user) return [];
    const { data: rows, error } = await client
      .from("contacts").select("contact_id").eq("owner_id", user.id);
    if (error) throw error;
    const ids = (rows || []).map((r) => r.contact_id);
    if (!ids.length) return [];
    const { data: profs, error: e2 } = await client
      .from("profiles").select("*").in("id", ids);
    if (e2) throw e2;
    return profs || [];
  }

  // Adiciona um contato buscando pelo nome de exibição.
  async function addContactByName(displayName) {
    if (!isConfigured()) return { ok: true, demo: true };
    const { data: { user } } = await client.auth.getUser();
    if (!user) throw new Error("Sessão expirada. Entre novamente.");

    const { data: found, error } = await client
      .from("profiles").select("id, display_name")
      .ilike("display_name", displayName.trim()).limit(1);
    if (error) throw error;
    if (!found || !found.length) throw new Error("Nenhum contato encontrado com esse nome.");
    if (found[0].id === user.id) throw new Error("Você não pode adicionar a si mesmo.");

    const { error: insErr } = await client
      .from("contacts").insert({ owner_id: user.id, contact_id: found[0].id });
    if (insErr && !/duplicate|unique/i.test(insErr.message)) throw insErr;
    return { ok: true, name: found[0].display_name };
  }

  /* ---------- Dados de demonstração ---------- */
  function demoProfile() {
    return { id: "demo", display_name: "Você", sub_nick: "", status: "online" };
  }
  function demoContacts() {
    return [
      { id: "d1", display_name: "Ana Clara ♥", sub_nick: "só vim ver as novidades", status: "online" },
      { id: "d2", display_name: "João Pedro", sub_nick: "ocupado estudando", status: "busy" },
      { id: "d3", display_name: "mayara", sub_nick: "", status: "offline" },
    ];
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
    getMyProfile, updateMyProfile, getContacts, addContactByName,
    getClient: () => client,
  };
})();
