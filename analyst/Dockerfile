# Acolyte Analyst: build from the repository root
#   docker build -f analyst/Dockerfile -t acolyte-analyst .
#   docker run -p 8000:8000 -e ANTHROPIC_API_KEY=... -e ANALYST_DATABASE_URL=... acolyte-analyst
FROM python:3.12-slim
WORKDIR /app
COPY analyst/requirements.txt analyst/requirements.txt
RUN pip install --no-cache-dir -r analyst/requirements.txt
COPY analyst/ analyst/
ENV PORT=8000
CMD ["sh", "-c", "uvicorn analyst.server:app --host 0.0.0.0 --port ${PORT} --proxy-headers --forwarded-allow-ips='*'"]
