# Engineering Data Health -- build from the repository root:
#   docker build -f apps/data_health/Dockerfile -t data-health .
#   docker run -p 8082:8082 data-health
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 OMP_NUM_THREADS=1
WORKDIR /srv

# PINNeAPPle depends on PyTorch; the CPU wheel keeps the image small.
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu

COPY . .
RUN pip install --no-cache-dir . -r apps/data_health/requirements.txt

ENV PYTHONPATH=/srv:/srv/apps/data_health
WORKDIR /srv/apps/data_health
EXPOSE 8082
HEALTHCHECK --start-period=90s CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8082/health')"
CMD ["uvicorn", "data_health.api:app", "--host", "0.0.0.0", "--port", "8082", "--workers", "2"]
