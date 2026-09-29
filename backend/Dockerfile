FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HABITFLOW_DATABASE_URL=sqlite:////app/data/habitflow.db

WORKDIR /app
COPY pyproject.toml ./
COPY app ./app
COPY alembic ./alembic
COPY alembic.ini ./
RUN pip install --no-cache-dir . && useradd --create-home --uid 10001 habitflow && mkdir -p /app/data && chown -R habitflow:habitflow /app

USER habitflow
EXPOSE 8000
CMD ["/bin/sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8000"]
