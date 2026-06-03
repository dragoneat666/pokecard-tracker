# node:20-alpine — same base as the backend, keeps things consistent
FROM node:20-alpine

WORKDIR /app

# Copy package files first for layer caching (same reason as backend)
COPY package.json .

RUN npm install

COPY . .

# Vite's dev server listens on port 3000 inside the container
# docker-compose maps this to 14000 on the host
EXPOSE 3000

# --host 0.0.0.0 is critical — without it Vite only listens on localhost
# INSIDE the container, which means nothing outside can reach it.
# 0.0.0.0 means "listen on all network interfaces" so Docker can forward traffic.
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "3000"]
