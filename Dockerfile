FROM python:3.11-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

RUN groupadd --system collabflow && \
    useradd --system --gid collabflow --no-create-home collabflow

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

FROM base AS production

COPY . .

RUN python manage.py collectstatic --noinput 2>/dev/null; exit 0

USER collabflow

EXPOSE 8000

CMD ["daphne", "-b", "0.0.0.0", "-p", "8000", "collabflow.asgi:application"]
