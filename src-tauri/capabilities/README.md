# Permissões da capability padrão

A capability compartilhada `default.json` declara explicitamente uma permissão adicional de janela, necessária ao guard de fechamento:

- `core:window:allow-destroy`: habilita a destruição da janela após a confirmação do salvamento.

O listener `onCloseRequested` é registrado pelo sistema de eventos e não requer permissão para invocar o comando `close`; por isso `core:window:allow-close` não foi adicionado à capability padrão. A permissão de destruição se aplica à janela `main`. Nenhuma permissão de filesystem, processo ou acesso a dados foi ampliada. A configuração de homologação mantém sua capability específica com `allow-close` e `allow-destroy`, conforme a validação do pacote rastreável.
