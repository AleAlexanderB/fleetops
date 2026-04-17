FROM node:20-alpine AS final

RUN apk add --no-cache openssl wget

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY src/ ./src/

RUN mkdir -p /app/data

EXPOSE 3100

ENV NODE_ENV=production
ENV GATEWAY_PORT=3100
ENV TZ=America/Argentina/Buenos_Aires

CMD ["node", "src/server.js"]
