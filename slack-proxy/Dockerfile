FROM node:24-alpine

WORKDIR /app/slack-proxy

COPY package.json package-lock.json ./
RUN apk add --no-cache git && npm ci --omit=dev

COPY lib.mjs runner.mjs server-logic.mjs server.mjs ./

ENV PORT=8080
ENV TWENTY_INTERNAL_URL=http://server:3000
ENV PATH=/app/slack-proxy/node_modules/.bin:$PATH

CMD ["node", "server.mjs"]
