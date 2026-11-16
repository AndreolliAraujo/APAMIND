# Procedimento de Segurança: Backup e Restauração APAMIND v0.7.1

Para garantir que você não perca nenhum dado ao desinstalar e reinstalar o APAMIND, siga rigorosamente este guia.

> **Importante**: O APAMIND salva apenas **caminhos/links** para arquivos anexados (PDFs, DOCs, atalhos `.lnk`, etc.), não os arquivos em si. Ao restaurar, os arquivos originais devem permanecer no mesmo local.

## 1. Como fazer o Backup (Antes de desinstalar)

O APAMIND salva os dados localmente no seu computador, mas ao desinstalar o programa, o Windows pode limpar os dados temporários e o banco de dados local. **Você deve exportar seus mapas manualmente.**

### Opção A: Backup Total (Recomendado)
Esta opção gera um único arquivo contendo **todos** os mapas que você criou.
1. Abra o APAMIND.
2. Clique no botão **Exportar** na barra superior.
3. Clique no botão azul: **💾 Backup Total (Todos os Mapas)**.
4. Salve o arquivo (ex: `apamind_backup_2024-02-15.json`) em um local seguro (ex: Google Drive, OneDrive ou um HD externo).

### Opção B: Exportar Mapa Individual
Se você quer ter certeza sobre um mapa específico:
1. Selecione o mapa desejado na barra lateral esquerda.
2. Clique em **Exportar** na barra superior.
3. Clique em **📄 Mapa (JSON)**.
4. Repita para cada mapa importante.

---

## 2. Como Restaurar (Após reinstalar)

Após instalar a nova versão do APAMIND, seu ambiente estará vazio. Para trazer seus dados de volta:

1. Abra o novo APAMIND.
2. Clique no botão **Importar** na barra superior.
3. Clique na área tracejada ("Clique para selecionar arquivo").
4. Selecione o arquivo de **Backup Total** que você salvou anteriormente.
5. O sistema perguntará: *"Este arquivo contém X mapas. Deseja importar todos eles?"*. Clique em **OK**.
6. Seus mapas aparecerão na lista lateral esquerda instantaneamente, com todas as notas, links, anexos e posições preservadas.

---

## Perguntas Frequentes

**O backup inclui os arquivos anexados (PDFs, Docs, etc)?**
Não. O APAMIND apenas guarda o **caminho** (link) para o arquivo no seu computador. O backup garante que, ao reinstalar, o APAMIND saiba onde esses arquivos estão para abri-los. Você não deve mover ou apagar os arquivos originais do seu computador.

**Qual arquivo é o mais seguro?**
O formato **JSON** (tanto o individual quanto o de Backup Total) é o único que contém 100% das informações técnicas do mapa. Arquivos Markdown, SVG ou PNG são apenas para visualização e não servem para restaurar o editor completamente.

**Posso confiar no Autosave?**
O Autosave é para o uso diário. Para trocas de versão ou desinstalação, a única garantia real é o **Backup Total (JSON)** exportado por você.
