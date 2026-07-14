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

  async function signUp(email, password, displayName) {
    if (!isConfigured()) {
      return demoAuth(email, password);
    }
    const { data, error } = await client.auth.signUp({
      email,
      password,
      options: { data: { display_name: displayName } },
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

  return { init, isConfigured, signIn, signUp, getSession, signOut, getClient: () => client };
})();
