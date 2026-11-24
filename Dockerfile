FROM node:24-alpine
WORKDIR /app
COPY --chown=node:node package.json server.mjs ./
COPY --chown=node:node src ./src
USER node
ENV NODE_ENV=production
EXPOSE 8080
CMD ["node", "server.mjs"]
