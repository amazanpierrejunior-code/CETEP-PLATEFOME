FROM node:20-bookworm-slim

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

RUN mkdir -p public && \
    find . -maxdepth 1 -type f \( \
      -name "*.html" -o \
      -name "*.css" -o \
      -name "*.js" -o \
      -name "*.png" -o \
      -name "*.jpg" -o \
      -name "*.jpeg" -o \
      -name "*.webp" -o \
      -name "*.svg" -o \
      -name "*.ico" \
    \) -exec cp -f {} public/ \;

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["npm", "start"]
