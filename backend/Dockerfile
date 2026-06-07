# ─── STAGE: base image ───────────────────────────────────────────────────────
# node:20-alpine is a minimal Linux image with Node.js 20 pre-installed.
# "alpine" means it's based on Alpine Linux — tiny footprint (~5MB vs ~900MB
# for a full Ubuntu image). Good for containers that don't need much.
FROM node:20-alpine

# Install postgresql-client for pg_dump and psql (needed for backup/restore)
RUN apk add --no-cache postgresql-client

# Set the working directory inside the container.
WORKDIR /app

# Copy package.json first — before copying source code.
COPY package.json .

# Install production dependencies only (skip nodemon etc.)
RUN npm install --omit=dev

# Copy the rest of the source code into the container
COPY src/ ./src/

# Document that the container listens on port 3001
EXPOSE 3001

# The command to run when the container starts
CMD ["node", "src/server.js"]
