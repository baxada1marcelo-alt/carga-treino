# Carga Treino

App de treino de academia para o celular: séries com descanso, reps e carga, cronômetro de descanso, supersérie, modelos de treino, biblioteca de exercícios, histórico com calendário, recordes e sugestão de progressão de carga.

Funciona offline e pode ser instalado na tela inicial do celular. Os dados ficam salvos no próprio aparelho; use **Ajustes → Exportar backup** de vez em quando.

## Apple Watch

Em **Ajustes → Apple Watch** o app mostra como criar um atalho “Série feita” no relógio: um toque registra a próxima série e inicia a contagem do descanso. A ponte entre relógio e celular é um pequeno servidor na Cloudflare (código em `servidor-relogio/`, publicado com `npx wrangler deploy`).
