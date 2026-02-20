FROM node:20-slim
RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY server.js .

# Download data files from GitHub (bypasses .dockerignore issues)
RUN mkdir -p data && \
    curl -sL https://raw.githubusercontent.com/ecashprotocol/ecash-solana/main/api/data/all-riddles-v3.json -o data/all-riddles-v3.json && \
    curl -sL https://raw.githubusercontent.com/ecashprotocol/ecash-solana/main/api/data/ecash_program.json -o data/ecash_program.json && \
    curl -sL https://raw.githubusercontent.com/ecashprotocol/ecash-solana/main/api/data/encrypted-blobs.json -o data/encrypted-blobs.json

CMD ["node", "server.js"]
