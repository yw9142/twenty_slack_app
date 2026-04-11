FROM node:24-alpine

WORKDIR /app

COPY lib.mjs server.mjs ./

ENV PORT=8080
ENV TWENTY_INTERNAL_URL=http://server:3000

CMD ["node", "server.mjs"]
