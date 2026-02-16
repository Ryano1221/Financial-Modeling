FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# OCR + PDF utilities for scanned lease extraction
RUN apt-get update && apt-get install -y --no-install-recommends \
    tesseract-ocr \
    tesseract-ocr-eng \
    poppler-utils \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV PYTHONPATH=/app

COPY requirements.txt ./
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

COPY . .

# Fail the build if required packages are missing (avoids runtime ModuleNotFoundError on Render)
RUN ls -la /app && ls -la /app/services && test -f /app/services/input_normalizer.py
RUN ls -la /app/models && test -f /app/models/legacy.py
RUN ls -la /app/cache && test -f /app/cache/disk_cache.py && test -f /app/cache/__init__.py

CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-10000}"]
