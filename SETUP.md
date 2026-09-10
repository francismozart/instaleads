# Guia do operador — instaleads

Passo a passo para colocar o sistema no ar na sua máquina. Este guia é para o
operador (você). A documentação técnica está em inglês no `README.md`.

O sistema faz prospecção autônoma no Instagram para a **Mozart Consultoria em TI**.
Dentro dos limites do `.env` e do painel, ele opera sozinho. Fora deles, ele
**pausa e chama você**.

---

## 0. Pré-requisitos

- **Node.js 22 ou superior** e **pnpm** (`npm i -g pnpm`).
- **Google Chrome** instalado (para o primeiro contato pelo navegador).
- Uma conta do Instagram já usada por você, logada uma única vez no perfil dedicado.
- (Para a API oficial) um App da Meta com o produto *Instagram* e webhook configurado.

Instale as dependências:

```bash
pnpm install
```

---

## 1. Chave da OpenAI (projeto separado, permissão restrita, teto mensal)

1. Acesse **https://platform.openai.com/api-keys**.
2. Crie a chave dentro de **um projeto separado** (não use o projeto padrão).
3. Dê permissão **`Restricted`** (somente o necessário).
4. Em **Settings → Limits**, defina um **hard limit mensal**. Isso é a sua rede de
   segurança financeira no provedor. O sistema também pausa sozinho ao atingir
   `OPENAI_MONTHLY_BUDGET_USD` — mantenha os dois alinhados.
5. Copie a chave e guarde no `.env` (próximo passo). A chave aparece **uma vez**.

---

## 2. Arquivo `.env`

```bash
cp .env.example .env
```

Preencha os valores. Os campos e o que significam estão comentados no próprio
`.env.example`. Os principais:

- `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_MODEL_FAST`, `OPENAI_MONTHLY_BUDGET_USD`
- `CHROME_CDP_URL` (padrão `http://127.0.0.1:9222`), `CHROME_PROFILE_DIR`
- `INSTAGRAM_APP_SECRET`, `INSTAGRAM_PAGE_ACCESS_TOKEN`,
  `INSTAGRAM_WEBHOOK_VERIFY_TOKEN`, `INSTAGRAM_BUSINESS_ACCOUNT_ID`
- `MAX_DMS_PER_DAY`, `MIN_SECONDS_BETWEEN_DMS`, `MAX_SECONDS_BETWEEN_DMS`,
  `OPERATING_HOURS`, `OPERATING_TIMEZONE`
- `STATE_ENCRYPTION_KEY` (gere com `openssl rand -hex 32`)

> **Nunca** faça commit do `.env`. Ele já está no `.gitignore`.

O `config/business.json` (identidade, oferta, ICP, afirmações) já vem preenchido
para a Mozart e também é ignorado pelo Git. Todo o resto do sistema lê dele — não
há dado real espalhado pelo código.

---

## 3. Chrome com perfil dedicado e debug em `127.0.0.1`

O primeiro contato sai pelo **seu Chrome real**, com sua sessão do Instagram já
logada. O Chrome 136+ recusa `--remote-debugging-port` no perfil padrão, então o
**perfil dedicado é obrigatório**, não uma preferência.

Suba o Chrome com um perfil separado e a porta de debug **presa no `127.0.0.1`**:

**macOS**
```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 \
  --remote-debugging-address=127.0.0.1 \
  --user-data-dir="$HOME/.instaleads-chrome"
```

**Linux**
```bash
google-chrome \
  --remote-debugging-port=9222 \
  --remote-debugging-address=127.0.0.1 \
  --user-data-dir="$HOME/.instaleads-chrome"
```

**Windows (PowerShell)**
```powershell
& "C:\Program Files\Google\Chrome\Application\chrome.exe" `
  --remote-debugging-port=9222 `
  --remote-debugging-address=127.0.0.1 `
  --user-data-dir="$env:USERPROFILE\.instaleads-chrome"
```

Com esse Chrome aberto, **faça login no Instagram uma única vez, na mão**. O agente
reusa esse contexto logado, abre a **própria aba**, nunca rouba o mouse/teclado e
nunca traz a janela para a frente. Ao terminar cada envio, fecha a aba dele.

> ⚠️ **Aviso de segurança.** A porta de debug dá **controle total** sobre a sessão
> logada. Mantenha em **`127.0.0.1`**, **nunca** `0.0.0.0`, e **nunca** em máquina
> compartilhada. Aponte `CHROME_PROFILE_DIR` para esse perfil dedicado.

---

## 4. Banco de dados

```bash
pnpm db:migrate
```

Cria o schema SQLite em `DATABASE_URL` (padrão `data/instaleads.db`), com WAL,
foreign keys e busy timeout. O SQLite é a fonte única de verdade.

---

## 5. Rodar

Um comando único sobe o **painel + worker**:

```bash
pnpm dev
```

- Painel: **http://localhost:3000** (em português).
- O worker roda junto, processando a fila de jobs.

Produção: `pnpm build && pnpm start`.

### Ver o fluxo sem credenciais (simulação)

```bash
pnpm e2e
```

Roda a esteira completa com dublês (sem rede, sem custo) e imprime a evidência de
cada fluxo crítico: descoberta, primeiro contato pelo navegador, handoff pelo
webhook, resposta pela API, encaminhamento ao WhatsApp, medição de A/B, custo de IA
e recuperação após reinício.

---

## 6. Operação diária

- **Pausar tudo:** botão **Pausa geral** no painel (ou a página inicial). Retomar no
  mesmo lugar. O sistema também pausa sozinho em situação de risco (navegador caiu,
  restrição do Instagram, janela da API fechada, orçamento estourado, erro em série).
- **Fila de exceções:** página **Exceções** — tudo que precisa de você.
- **Limites:** página **Configurações** — DMs/dia, intervalo, janela de operação.
  O aquecimento começa em 5/dia na 1ª semana e sobe +5 por semana até o teto.
- **Kanban:** página **Leads** — funil de clientes e funil de afiliados, separados.
- **Custo de IA:** no painel, custo por lead e por cliente ativo.

### Homologação progressiva (recomendada)

1. `pnpm e2e` — simulação.
2. **Dry-run real:** `BROWSER_DRY_RUN=1` — faz tudo, menos a tecla final de envio.
3. **Smoke test real e limitado:** só depois da sua autorização explícita, com
   `MAX_DMS_PER_DAY` bem baixo, acompanhando de perto.
4. Piloto limitado → autonomia.

---

## 7. Backup e restauração

**Backup** (pode rodar com o sistema no ar):

```bash
pnpm db:backup     # gera backups/instaleads-<timestamp>.db
```

**Restaurar:**

1. Pare o painel e o worker.
2. Copie o backup escolhido por cima do arquivo em `DATABASE_URL`.
3. Apague os arquivos `*.db-wal` e `*.db-shm` ao lado do destino.
4. Suba de novo (`pnpm start`). As migrações são idempotentes.

---

## 8. E se a chave da OpenAI vazar?

1. **Revogue imediatamente** a chave em
   **https://platform.openai.com/api-keys** (Revoke).
2. Crie uma nova chave (projeto separado, `Restricted`, hard limit).
3. Atualize `OPENAI_API_KEY` no `.env` e reinicie (`pnpm start`).
4. Confira o uso em **Usage** no painel da OpenAI e no painel do instaleads
   (custo de IA) para detectar consumo anômalo.
5. Como o `.env` é ignorado pelo Git, o vazamento não vem do repositório — verifique
   prints, logs e a máquina. Os logs do sistema já mascaram segredos.

---

## Regras que o sistema nunca quebra

- Só envia o que está em **afirmações verificadas**. Nunca inventa taxa, condição,
  garantia, relação societária ou superlativo. Nunca promete aprovação de conta nem
  resultado financeiro.
- Pedido de parar é atendido na hora: o perfil entra em **não contatar**, permanente,
  sem reentrada por nenhuma campanha ou canal.
- Ritmo humano por **saúde da conta** — não para burlar detecção. Sem forjar
  fingerprint, sem mascarar automação, sem API privada, sem contornar restrição.
