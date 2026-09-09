FROM node:22-alpine
WORKDIR /app
COPY --chown=node:node package.json server.mjs ./
ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080
USER node
CMD ["node", "server.mjs"]
