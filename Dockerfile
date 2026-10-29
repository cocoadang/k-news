FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY dist ./dist
RUN node -e "require('fs').writeFileSync('firebase-applet-config.json',JSON.stringify({projectId:'gen-lang-client-0064554427',firestoreDatabaseId:'ai-studio-spacexintelligen-5ece8bd2-4283-450c-8ff7-bbc38569174d'}))"
EXPOSE 8080
CMD ["node","dist/server.cjs"]
