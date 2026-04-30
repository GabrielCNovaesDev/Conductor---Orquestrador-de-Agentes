FROM node:20-alpine AS development
WORKDIR /app
COPY package*.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/orchestrator/package.json packages/orchestrator/package.json
COPY packages/connectors/package.json packages/connectors/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm install
COPY . .
EXPOSE 5173
CMD ["npm", "run", "dev", "--workspace=@repo/web"]
