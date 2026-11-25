# Exportar do CorelDRAW ou do Inkscape

O SVG Motion Studio lê o SVG que o teu programa de desenho já sabe exportar. Não há
plugin, não há passo intermédio: exportas, arrastas o ficheiro para o editor (ou passas
`sms import`), e o estúdio trata do resto.

O que se segue é o caminho mais curto para um ficheiro que anima bem.

---

## CorelDRAW

### Exportar

1. **Ficheiro → Exportar** (ou `Ctrl+E`).
2. Formato: **SVG**.
3. Nas opções de exportação escolhe o perfil **SVG 1.1** (não "SVG Tiny", que descarta
   gradientes e filtros).
4. Marca:
   - ✅ **Exportar texto como curvas** — evita depender de fontes que não existem no
     browser.
   - ✅ **Embutir fontes** — só se quiseres texto editável mais tarde.
5. Desmarca:
   - ❌ **Exportar metadados (RDF)** — o estúdio remove-os de qualquer forma.
6. **OK**.

### O que o estúdio faz com o resultado

| O CorelDRAW escreve | O estúdio faz |
| --- | --- |
| `width="210mm" height="297mm"` | Lê o `viewBox` e passa a largura e altura a unidades de utilizador |
| Atributos `corel:*`, `i:*`, `xmlns:*` | Remove-os — não desenham nada |
| `id="Layer_x0020_1"` | Mantém o id (é válido) e mostra `Layer 1` como nome da camada |
| `style="fill:#ff3366;stroke:none"` | Passa cada propriedade a atributo de apresentação |
| `<metadata>` com bloco RDF | Remove |

**Camadas:** cada grupo de topo no CorelDRAW aparece como uma camada. Dá-lhes nomes no
CorelDRAW (Janela → Dockers → Gestor de Objetos) e esses nomes aparecem no painel de
camadas.

---

## Inkscape

O Inkscape é o caso mais fácil: já escreve SVG que o estúdio interpreta quase sem tocar.

### Exportar

1. **Ficheiro → Guardar como** (não "Guardar uma cópia").
2. Tipo: **SVG simples** (*Plain SVG*) — este é o passo que importa.
   - Se guardares como **SVG do Inkscape**, o ficheiro leva `sodipodi:namedview`, blocos
     RDF e atributos `inkscape:*`. O estúdio limpa-os, mas o ficheiro é maior e o
     relatório de importação enche-se de ruído.
3. Em **Preferências → Entrada/Saída → Exportação de SVG**, desmarca
   *"Guardar metadados do documento"* se quiseres ficheiros mais limpos.

### Camadas

O Inkscape marca camadas com `inkscape:groupmode="layer"` e um rótulo. O estúdio lê o
rótulo antes de remover o atributo, por isso:

- **Camada → Mudar o nome da camada** define o nome que vais ver no painel de camadas.
- Camadas ocultas (o olho fechado em Inkscape) chegam com `display:none` e aparecem
  marcadas no relatório.

### Estilos

O Inkscape guarda estilos em `<style>` com classes (`.fil0`, `.str0`). O estúdio achata
esse CSS em atributos no elemento, porque a animação precisa do valor ali e não numa
folha de estilo partilhada. Seletores suportados: tipo, `*`, `.classe`, `#id`, compostos
e combinadores descendente e filho. `:hover`, seletores de atributo e combinadores de
irmãos são reportados e ignorados.

---

## O que funciona e o que não funciona

### Funciona bem

- Formas geométricas (`rect`, `circle`, `ellipse`, `line`, `polyline`, `polygon`, `path`)
- Grupos e transformações estáticas
- Gradientes lineares e radiais
- Texto (melhor já convertido em curvas)
- Imagens embutidas (`<image>` com base64)
- Múltiplas camadas

### Funciona com avisos

- **Texto como `<text>`** — a caixa delimitadora é aproximada (sem motor de fontes). A
  animação corre; a seleção no editor pode não envolver o texto com exatidão.
- **Filtros SVG** (`<filter>`) — preservados, mas os exportadores SMIL e CSS não animam
  parâmetros de filtro. Anima a opacidade do grupo em vez disso.
- **`<use>`** — preservado; anima o elemento original, não a instância.
- **Padrões e máscaras** — preservados e desenhados; não animáveis pelo estúdio.

### Não funciona

- **Tiny SVG / SVG Basic** — falta o suporte a gradientes e filtros. Exporta como SVG 1.1.
- **Texto que depende de fontes não instaladas** — o browser substitui a fonte e o
  resultado muda. Converte para curvas.
- **Símbolos e sprite sheets** — o `viewBox` por `<symbol>` não é lido.

---

## Um fluxo completo, do desenho ao ficheiro animado

```sh
# 1. exporta o desenho como myself.svg (CorelDRAW: SVG 1.1; Inkscape: SVG simples)

# 2. limpa o ficheiro e descobre a estrutura
sms import myself.svg --out work

#    · detect: source looks like Inkscape
#    · metadata: removed 1 editor element(s) and 6 editor attribute(s)
#    · css: flattened 3 rule(s) from 1 <style> element(s) into attributes
#    · layers: found 2 layer(s)
#    ✓ wrote work/clean.svg
#    ✓ wrote work/scene.json

# 3. dá vida a uma camada
sms animate work/scene.json --preset pop --target ball --out work/scene.json

# 4. exporta o SVG animado
sms export work/scene.json --format smil --out work/animation.svg

# 5. ou um player autónomo para enviar a alguém
sms player work/scene.json --out work/player.html
```

No editor, o mesmo em quatro gestos: arrastar o ficheiro, escolher a camada, tocar numa
predefinição, tocar em **Exportar**.

---

## Problemas comuns

**"Não consegui ler o SVG"**
O ficheiro não é XML bem formado. Abre-o num editor de texto: se começar com `<html`,
exportaste uma página em vez do desenho.

**O desenho aparece mas nada se move**
A camada escolhida não tem animadores. Vê o contador no painel **Animar**; se estiver a
`0`, toca numa predefinição.

**As cores mudaram**
Provavelmente o desenho usa `currentColor` ou herda de uma classe que não foi achatada.
Verifica os avisos do relatório de importação.

**"reference to missing id"**
Um gradiente ou clip-path aponta para um id que não existe — normalmente porque o
CorelDRAW exportou uma referência a um recurso que ficou de fora. O estúdio mantém a
referência e avisa; o desenho aparece sem esse preenchimento.
