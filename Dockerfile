FROM node:20-bookworm-slim

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

# The application serves browser files from /app/public.
# Copy root web assets there so the same project works on Render and locally.
RUN mkdir -p /app/public /app/data && \
    find /app -maxdepth 1 -type f \( \
      -name "*.html" -o -name "*.css" -o -name "*.js" -o \
      -name "*.png" -o -name "*.jpg" -o -name "*.jpeg" -o \
      -name "*.webp" -o -name "*.svg" -o -name "*.ico" \
    \) -exec cp -f {} /app/public/ \;

ENV NODE_ENV=production
ENV PORT=10000

EXPOSE 10000

CMD ["npm", "start"]
