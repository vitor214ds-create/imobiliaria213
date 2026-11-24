# Imobiliaria213

oi

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/17dc1db0-7fd3-43e7-b4d6-b8162030f0bc).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```


## Imobiliária Studio — Virtual Staging

Instale Node.js 22+, clone o repositório e execute `npm run studio`. Abra http://localhost:8787. O estúdio local não necessita de npm install. Não exponha este servidor à internet: ele não tem autenticação multiusuário.

Na aba Conexões, configure Gemini (chave em https://aistudio.google.com/apikey), Virtual Staging AI (chave API v2), Kling (token Bearer oficial válido) e Google Cloud Veo (ID do projeto, Vertex AI API habilitada, faturamento e permissões). Para Google Cloud, instale gcloud e execute `gcloud auth application-default login` e `gcloud auth application-default set-quota-project SEU_PROJETO`, ou informe token OAuth temporário. O teste do Veo verifica acesso ao projeto, não geração. Não há login direto no Google Flow: usamos Vertex AI para o mesmo método de primeiro/último frame. Veo 2 Fast é legado; o padrão é Veo 3.1 Fast, 8 segundos. Kling usa 5 ou 10 segundos. Modelos, tarifas e permissões dependem do provedor.

Envie JPG/PNG de até 10 MB, escolha cômodo e estilo, gere a imagem, compare os frames e gere o vídeo. O botão automático executa as duas etapas, após confirmação de possíveis custos. O giro de 90 graus é opcional e deve ser revertido em editor externo. Baixe os arquivos antes de fechar; a mídia local é temporária. Informe que a decoração/construção é simulação virtual.

Chaves não são versionadas nem gravadas pelo estúdio. Também podem ser fornecidas em variáveis de ambiente GEMINI_API_KEY, GOOGLE_PROJECT, GOOGLE_ACCESS_TOKEN, VSA_API_KEY e KLING_API_KEY. Não use senhas de contas. As imagens são enviadas ao provedor escolhido. Não há garantia de gratuidade nem de preservação perfeita da arquitetura. Integrações precisam de validação com credenciais reais; não há persistência de projetos, login multiusuário ou edição final de áudio. Execute `npm run studio:check` para conferir sintaxe.


## Contingência sem Lovable

A interface manual independente está em `public/studio/`. Abra `public/studio/index.html` localmente no navegador ou publique somente essa pasta em hospedagem estática. No Lovable, após build/publicação, o caminho esperado é `/studio/index.html`. Ela funciona sem login, API ou servidor; não realiza geração por IA automaticamente. Arquivos ficam no navegador, temporariamente. Não publique arquivos .env nem o servidor local.

A versão em nuvem usa os Secrets GEMINI_API_KEY, GOOGLE_SERVICE_ACCOUNT_JSON, VSA_API_KEY, KLING_ACCESS_KEY, KLING_SECRET_KEY e STUDIO_OWNER_USER_ID. Configure no ambiente de hospedagem, não no GitHub. As credenciais locais descritas acima são exclusivas do servidor legado.


## Estrutura de produção

O servidor Node legado e seus arquivos HTML/CSS/JS estão em `legacy-local/` para evitar que o Nitro detecte `server.mjs` ou `index.html` como entrada de produção. O comando `npm run studio` permanece válido para uso local. A versão principal usa `src/server.ts` e `src/routes/index.tsx`; a alternativa estática permanece em `public/studio/`.
