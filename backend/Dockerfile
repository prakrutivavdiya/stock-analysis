FROM python:3.12-slim AS base

WORKDIR /app

# System deps for asyncpg + cryptography
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq-dev gcc && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt ./backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

# Copy source (package layout: /app/backend/)
COPY backend/ ./backend/

COPY backend/entrypoint.sh ./entrypoint.sh
RUN chmod +x entrypoint.sh

EXPOSE 8000
ENTRYPOINT ["./entrypoint.sh"]
