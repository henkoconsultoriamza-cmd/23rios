FROM node:22-slim

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

RUN apt-get update && apt-get install -y \
    chromium \
    fonts-liberation \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
RUN npm install --ignore-scripts

COPY index.js ./
COPY . .

# cache bust: 2026-10-13c
EXPOSE 3000

CMD ["node", "index.js"]
