FROM python:3.13-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ ./backend/
COPY frontend/ ./frontend/

ENV APP_HOST=0.0.0.0
ENV APP_PORT=3000

EXPOSE 3000

# Spawner by default. Kubeling pods override this in their K8s pod spec:
#   command: ["python", "-m", "backend.pod.main"]
CMD ["python", "-m", "backend.spawner.main"]
