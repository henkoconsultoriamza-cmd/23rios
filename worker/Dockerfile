FROM node:22-slim

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

RUN apt-get update && apt-get install -y \
    chromium \
    fonts-liberation \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ARG CACHEBUST=20261013d
COPY package.json ./
RUN npm install

COPY . .

EXPOSE 3000

CMD ["node", "index.js"]
