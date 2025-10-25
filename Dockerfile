# Imagem base com Debian (boa para sharp e poppler)
FROM node:20-bullseye

# Instala Poppler e Tesseract (inclui português)
RUN apt-get update && apt-get install -y \
    poppler-utils \
    tesseract-ocr \
    tesseract-ocr-por \
  && rm -rf /var/lib/apt/lists/*

# Diretório app
WORKDIR /app

# Instala dependências do Node
COPY package*.json ./
RUN npm ci

# Copia o restante do código
COPY . .

# Gera Prisma Client e build do Next
RUN npx prisma generate
RUN npm run build

# Variáveis padrão (podem ser sobrescritas no host)
ENV NODE_ENV=production
ENV UPLOADS_DIR=/app/storage/uploads
# importante: apontar o SQLite para o disco persistente
ENV DATABASE_URL="file:/app/storage/dev.db"

# Porta exposta
EXPOSE 3000

# Start: garante pastas + db push e inicia
CMD npm run prestart && npm run start
