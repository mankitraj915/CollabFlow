# CollabFlow Deployment Guide

This guide details the steps to deploy CollabFlow to a production environment.

## 1. Prerequisites
- A production-grade PostgreSQL database.
- A Redis instance (for Django Channels and Caching).
- A reverse proxy (e.g., NGINX, Caddy, or Traefik) to handle SSL/TLS termination.
- A Docker-compatible hosting environment.

## 2. Environment Variables
In production, you MUST override the default values. Create a `.env` file on the host:
```ini
DJANGO_SECRET_KEY=generate-a-secure-random-key
DJANGO_DEBUG=False
DJANGO_ALLOWED_HOSTS=yourdomain.com,api.yourdomain.com

POSTGRES_DB=collabflow_prod
POSTGRES_USER=prod_user
POSTGRES_PASSWORD=secure_db_password
POSTGRES_HOST=your-db-host
POSTGRES_PORT=5432

REDIS_URL=redis://your-redis-host:6379/0
```

## 3. ASGI and WebSockets (Daphne)
CollabFlow uses Django Channels and requires an ASGI server. The provided `Dockerfile` uses `daphne`.

Ensure your reverse proxy is configured to handle WebSocket upgrade headers. 

### NGINX Example:
```nginx
server {
    listen 80;
    server_name yourdomain.com;

    location / {
        proxy_pass http://localhost:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /ws/ {
        proxy_pass http://localhost:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }

    location /static/ {
        alias /path/to/collabflow/staticfiles/;
    }
}
```

## 4. Static Files
Static files must be collected using `python manage.py collectstatic`. If running in Docker, the `Dockerfile` already performs this step, but your web server needs to know where to serve them from, or you can serve them via WhiteNoise (add it to your requirements and middleware if preferred).

## 5. Security Checklist
- [ ] Set `DJANGO_DEBUG=False`.
- [ ] Set a strong, unique `DJANGO_SECRET_KEY`.
- [ ] Ensure `SESSION_COOKIE_SECURE=True` and `CSRF_COOKIE_SECURE=True` in settings (already handled in `settings.py` when not in DEBUG).
- [ ] Use HTTPS in production to protect WebSocket traffic (`wss://`) and session cookies.
