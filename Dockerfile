FROM node:20-bookworm-slim

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

# Keep files already present in /app/public: these are the canonical,
# deliberately maintained versions of student.html, admin.html and other assets.
# Copy root-level legacy assets only when the corresponding public file is absent.
RUN mkdir -p /app/public /app/data && \
    find /app -maxdepth 1 -type f \( \
      -name "*.html" -o -name "*.css" -o -name "*.js" -o \
      -name "*.png" -o -name "*.jpg" -o -name "*.jpeg" -o \
      -name "*.webp" -o -name "*.svg" -o -name "*.ico" \
    \) -exec cp -n {} /app/public/ \;

ENV NODE_ENV=production
ENV PORT=10000

EXPOSE 10000

CMD ["npm", "start"]
