# Terrima — Deploy no Vercel

## Estrutura
```
terrima-app/
  index.html      ← Frontend (abre direto no browser, sem iframe)
  api/proxy.js    ← Função serverless (roteia chamadas ao Apps Script)
  vercel.json     ← Configuração de rotas
  Code.gs         ← Backend Apps Script (modo API REST)
  package.json
```

---

## Passo 1 — Atualizar o Apps Script

1. Abra **script.google.com** e entre no projeto Terrima
2. Substitua o conteúdo de **Code.gs** pelo arquivo `Code.gs` deste pacote
3. Vá em **Implantar → Gerenciar implantações**
4. Clique em ✏️ (editar) na implantação atual  
   - **Executar como:** Eu (sua conta)  
   - **Quem tem acesso:** Qualquer pessoa  
5. Clique em **Implantar** e **copie a URL** gerada  
   - Formato: `https://script.google.com/macros/s/SEU_ID/exec`

> ⚠️ Toda vez que mudar o Code.gs, crie uma **nova versão** na implantação.

---

## Passo 2 — Deploy no Vercel

### Opção A — Via GitHub (recomendado)
1. Crie um repositório no GitHub e faça push desta pasta
2. Acesse **vercel.com** e importe o repositório
3. Na tela de configuração, adicione a variável de ambiente:
   - **Name:** `GAS_URL`  
   - **Value:** A URL copiada no Passo 1
4. Clique em **Deploy**

### Opção B — Via Vercel CLI
```bash
npm i -g vercel
cd terrima-app
vercel --prod
# Quando perguntar sobre env vars, adicione GAS_URL
```

---

## Passo 3 — Testar

Acesse a URL do Vercel (ex: `https://terrima-app.vercel.app`)

Para testar o backend isolado, abra no browser:
```
https://terrima-app.vercel.app/api/proxy?action=ping
```
Deve retornar: `{"ok":true,"ts":"2026-..."}`

---

## Vantagens vs Apps Script direto

| | Apps Script | Vercel + Apps Script |
|---|---|---|
| URL | Script URL longa | URL própria curta |
| iframe | Sim (limitações) | Não — abre direto |
| Performance | Lenta (cold start ~3s) | Frontend instantâneo |
| CORS | Bloqueado | Resolvido pelo proxy |
| Custo | Grátis | Grátis |

---

## Atualizar o app depois

- **Só frontend** (visual/JS): editar `index.html` e fazer push/redeploy no Vercel
- **Backend** (lógica de dados): editar `Code.gs` no Apps Script + nova versão de implantação
