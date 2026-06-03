# ─── STAGE: base image ───────────────────────────────────────────────────────
# node:20-alpine is a minimal Linux image with Node.js 20 pre-installed.
# "alpine" means it's based on Alpine Linux — tiny footprint (~5MB vs ~900MB
# for a full Ubuntu image). Good for containers that don't need much.
FROM node:20-alpine

# Set the working directory inside the container.
# All subsequent commands run from here. If it doesn't exist, Docker creates it.
WORKDIR /app

# Copy package.json first — before copying source code.
# WHY: Docker builds in layers. If package.json hasn't changed, Docker reuses
# the cached "npm install" layer and skips reinstalling packages. This makes
# rebuilds much faster when you only changed source code.
COPY package.json .

# Install production dependencies only (skip nodemon etc.)
# --omit=dev means devDependencies in package.json are ignored
RUN npm install --omit=dev

# Copy the rest of the source code into the container
COPY src/ ./src/

# Document that the container listens on port 3001
# (This doesn't actually open the port — that's done in docker-compose.yml)
EXPOSE 3001

# The command to run when the container starts
CMD ["node", "src/server.js"]
