FROM node:22-alpine
RUN apk add --no-cache su-exec
WORKDIR /app
COPY package.json core.js server.js mcp.js ./
COPY public ./public
COPY docker-entrypoint.sh /usr/local/bin/
ENV PORT=8787 VALETORA_DATA=/data/valetora.json NODE_ENV=production
EXPOSE 8787
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "server.js"]
