ARG NODE_BASE_IMAGE=docker.m.daocloud.io/library/node:22-alpine
FROM ${NODE_BASE_IMAGE}

WORKDIR /app
ENV NODE_ENV=production

COPY package.json ./
COPY src ./src
COPY public ./public

EXPOSE 8080
CMD ["node", "src/index.js"]
