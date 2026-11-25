# No Android, com Termux

O SVG Motion Studio corre inteiro no telemóvel. Não há conta, não há servidor, não há
nada a instalar da Play Store além do Termux: o motor é TypeScript puro e o editor é um
único ficheiro HTML.

Há dois caminhos, e valem a pena os dois:

- **O editor** — uma interface gráfica completa, no browser. É o caminho normal.
- **O CLI** — `sms`, para automação e para quando queres trabalhar por comandos.

---

## Preparar o Termux (uma vez)

```sh
pkg update && pkg upgrade -y
pkg install nodejs git -y
```

Verifica:

```sh
node -v      # precisa de v18 ou mais recente; v20+ recomendado
git --version
```

> Se `pkg install nodejs` falhar, corre `pkg update` primeiro. O Termux instala Node a
> partir do seu próprio repositório, não do npm.

---

## Instalar o estúdio

```sh
git clone https://github.com/daggomodesign/svg-motion-studio.git
cd svg-motion-studio
npm install
npm run build
```

`npm install` demora um ou dois minutos no telemóvel. Não há dependências nativas — só
TypeScript e esbuild, ambos com binários pré-compilados para `linux-arm64`.

Verifica que está tudo bem:

```sh
node packages/cli/dist/src/cli.js doctor
#   node v20.x ok
#   platform android (Termux)
#   editor built
```

### Atalho para o comando `sms`

Em vez de escrever o caminho completo:

```sh
npm link --workspace=@svg-motion-studio/cli
# agora:
sms info
```

Se o `npm link` der problemas no Termux, usa um alias:

```sh
echo "alias sms='node $HOME/svg-motion-studio/packages/cli/dist/src/cli.js'" >> ~/.bashrc
source ~/.bashrc
```

---

## Abrir o editor no browser do Android

O editor é um ficheiro só. Duas formas de o abrir:

### A. Servir localmente (recomendado)

```sh
sms serve --port 8080
#   serve editor at http://localhost:8080/
```

Abre o Chrome (ou o Firefox) do telemóvel em `http://localhost:8080/`.

Uma nota sobre `localhost` no Android: apps diferentes têm stacks de rede diferentes, e
alguns browsers não conseguem chegar ao servidor do Termux em `localhost`. Se a página
não abrir, usa o IP da rede local:

```sh
ifconfig 2>/dev/null | grep "inet " | grep -v 127.0.0.1
# inet 192.168.1.42  ← usa este
```

e abre `http://192.168.1.42:8080/`. Nesse caso, garante que estás na mesma rede Wi-Fi e
que o firewall não bloqueia a porta.

### B. Abrir o ficheiro diretamente

```sh
termux-open packages/editor/dist/editor.html
```

Abre no browser por omissão. Funciona porque o editor é um ficheiro autónomo: CSS, JS e
ícones estão todos lá dentro, sem um único pedido externo. Arrastar ficheiros não
funciona em todos os browsers do Android; nesse caso usa **Importar → Escolher ficheiro**.

---

## O editor no telemóvel

A interface adapta-se ao ecrã:

- **Retrato, até 900 px** — uma coluna, com uma barra de separadores em baixo:
  **Camadas · Tela · Timeline · Animar**.
- **Paisagem** — a tela ganha a altura toda e a barra de aplicação encolhe.
- **Tablet, até 1180 px** — três colunas com painéis mais estreitos.

Gestos que valem a pena saber:

| Gesto | Ação |
| --- | --- |
| Tocar numa camada | Seleciona-a (a seleção aparece contornada na tela) |
| Tocar numa predefinição | Acrescenta essa animação à camada selecionada |
| Arrastar a barra da timeline | Percorre a animação fotograma a fotograma |
| Duplo toque na barra de tempo | (no browser) zoom — o resto da página está bloqueado |

Acessibilidade: todos os botões de ícone têm rótulo para leitores de ecrã, o foco é
sempre visível, e se o telemóvel estiver em modo de movimento reduzido a pré-visualização
não arranca sozinha.

---

## Trabalhar com ficheiros do telemóvel

Os desenhos do CorelDRAW e do Inkscape raramente estão no telemóvel. O caminho normal é:

1. Exportar no computador (ver [IMPORT-PT.md](IMPORT-PT.md)).
2. Passar o ficheiro para o telemóvel — Drive, Telegram, cabo USB, o que for.
3. Em Termux, os ficheiros descarregados estão normalmente em
   `/sdcard/Download/`. Para lá chegar:

```sh
termux-setup-storage      # uma vez, autoriza o acesso
ls ~/storage/downloads/
```

4. Importar:

```sh
sms import ~/storage/downloads/poster.svg --out ~/poster
```

O `~/poster/` fica com `clean.svg` e `scene.json`. A partir daí, `sms animate` e
`sms export`.

---

## O fluxo completo no telemóvel

```sh
# 1. importar o desenho exportado do computador
sms import ~/storage/downloads/poster.svg --out ~/poster

# 2. ver a estrutura
sms info
cat ~/poster/scene.json | head -20

# 3. animar cada elemento automaticamente
sms auto ~/poster/scene.json --out ~/poster/scene.json

# 4. afinar uma camada à mão
sms animate ~/poster/scene.json --preset draw --target line --out ~/poster/scene.json

# 5. exportar
sms export ~/poster/scene.json --format smil --out ~/poster/poster.svg

# 6. uma versão que qualquer pessoa abre
sms player ~/poster/scene.json --out ~/poster/poster.html

# 7. enviar
termux-share ~/poster/poster.html
```

`termux-share` abre o menu de partilha do Android — WhatsApp, Telegram, Drive, email.

---

## Desempenho no telemóvel

O que é pesado e o que não é:

| Operação | Custo | Nota |
| --- | --- | --- |
| `sms import` | baixo | Análise XML; instantâneo até alguns MB |
| `sms export` | baixo | Serialização de texto |
| Editor, desenho com < 200 elementos | suave | 60 fps na pré-visualização |
| Editor, desenho com 1000+ elementos | pode engasgar | Fecha as camadas que não estás a animar |
| `npm install` | alto | Uma vez; precisa de ~300 MB livres |

Se o editor estiver lento, a causa quase sempre é um desenho com muitos elementos
individuais. No Inkscape, agrupa formas relacionadas antes de exportar: um grupo anima-se
como um só e o browser desenha muito menos.

---

## Limitações honestas

- **Sem APK.** Isto corre no browser e no Termux; não há (ainda) uma app instalável. O
  editor funciona bem como atalho no ecrã inicial do Chrome ("Adicionar ao ecrã
  principal"), mas é uma página web, não uma app nativa.
- **Sem pré-visualização ao vivo do ficheiro em edição.** O editor não recarrega sozinho
  quando mudas o `scene.json` no terminal; exporta e reabre.
- **Ficheiros grandes (> 5 MB).** O browser do Android começa a sofrer. Simplifica o
  desenho antes de importar.
