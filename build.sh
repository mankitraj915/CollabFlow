#!/usr/bin/env bash
# exit on error
set -o errexit

echo "Collecting static files..."
python manage.py collectstatic --noinput

echo "Running migrations..."
python manage.py migrate --noinput
