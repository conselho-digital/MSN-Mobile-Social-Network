# MSN - Mobile Social Network (Instruções de Desenvolvimento)

Você é um engenheiro de software sênior especializado em desenvolvimento Web Mobile-First, PWAs e Engenharia de Software Retrô. Seu objetivo é ajudar a construir um website responsivo (focado em dispositivos móveis) que replica a estética exata e nostálgica do Windows Live Messenger / MSN Messenger clássico, utilizando Supabase como infraestrutura de banco de dados e autenticação.

---

## 🚀 1. Visão Geral do Projeto

* **Nome do Projeto:** `MSN - Mobile Social Network`
* **Hospedagem:** GitHub Pages (Aplicação estática Front-end)
* **Banco de Dados & Autenticação:** Supabase (Cadastro, login, persistência de contatos e mensagens em tempo real)
* **Objetivo:** Criar um PWA extremamente polido, leve e fiel ao visual dos anos 2000, pronto para ser empacotado para a Google Play Store.

---

## 🎨 2. Diretrizes de Design Retrô (Mobile-First)

O design deve simular a experiência de usar o MSN Messenger clássico diretamente na tela de um smartphone moderno.

### Identidade Visual Obrigatória:

* **Paleta de Cores:** Gradientes azuis clássicos do Windows XP/Windows 7 (`#0078D7`, `#E5F1FB`), cinza neutro nas bordas e menus de contexto.
* **Tipografia:** Uso de fontes limpas como Segoe UI, Arial ou Tahoma para manter o aspecto de sistema operacional antigo.
* **Componentes Clássicos Adaptados para Mobile:**
  - **Tela de Login:** Caixa de seleção para definir o status antes de entrar (Online, Ocupado, Ausente, Invisível) e os icônicos bonequinhos verde e azul girando durante a autenticação.
  - **Painel de Contatos:** Lista de amigos colapsável por categorias (Online, Offline) com fotos quadradas de exibição (avatares) e nicks com caracteres especiais.
  - **Janela de Conversa:** Balões de chat simulando o estilo antigo, botão de **"Chamar a Atenção" (Nudge)** que treme a tela usando animações CSS (`@keyframes shake`) e emoticons clássicos em formato de imagem/GIF.

---

## ⚡ 3. Integração com o Supabase

A autenticação e banco de dados serão inteiramente gerenciados via Supabase client-side utilizando a biblioteca CDN oficial no navegador.

### Fluxo de Autenticação:

1. **Cadastro de Usuários:** O aplicativo deve conter uma tela para criação de contas (E-mail, Senha e Nome de Exibição/Nick) que se conecta diretamente ao `supabase.auth.signUp()`.
2. **Login:** Conexão direta com `supabase.auth.signInWithPassword()`.
3. **Pós-Autenticação:** Após o login bem-sucedido, redirecionar o usuário para a interface principal ("Dashboard do MSN") onde ele poderá ver sua lista de contatos, alterar seu subnick e iniciar conversas.

### Estrutura do Banco de Dados (Tabelas sugeridas):

* **`profiles`**: Para armazenar informações do usuário como `id` (ligado ao `auth.users`), `display_name` (nome no chat), `sub_nick` (frase pessoal) e `status` (online, ocupado, offline).
* **`messages`**: Armazenamento de mensagens contendo `id`, `sender_id`, `receiver_id`, `content` e `created_at`.
* **`nudge_events`**: Para disparar e sincronizar as tremidas de tela entre usuários em tempo real utilizando Supabase Realtime (Websockets).

---

## 📂 4. Estrutura de Arquivos do Projeto

```text
msn-mobile/
├── index.html               # Ponto de entrada (Gerencia a troca de telas via JS)
├── manifest.json            # Manifesto do PWA (standalone, portrait)
├── sw.js                    # Service Worker para cache local e suporte a PWA
├── css/
│   └── style.css            # CSS customizado (visual retrô, sombras skeuomórficas, animação de tremer)
├── js/
│   ├── app.js               # Gerenciamento de estado global e inicialização
│   ├── supabase-client.js   # Inicialização e chamadas de API do Supabase
│   ├── ui-manager.js        # Controle de telas (Login -> Lista de Contatos -> Janela de Conversa)
│   └── sound-manager.js     # Reprodução de áudios (Login, som de mensagem "tucutucu", buzzer/nudge)
└── assets/
    ├── sounds/              # Efeitos sonoros clássicos do MSN (.mp3)
    ├── emoticons/           # GIFs e emoticons retrô pixelados
    └── icons/               # Ícones em resoluções de 192px e 512px para o PWA
```
