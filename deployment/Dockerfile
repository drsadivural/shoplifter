FROM python:3.12-slim
WORKDIR /app
COPY . /app
RUN useradd --uid 10001 --create-home retailguard
USER 10001
ENV PYTHONDONTWRITEBYTECODE=1 RETAILGUARD_DATA=/data RETAILGUARD_PORT=8788
CMD ["python3", "reference/server.py", "serve"]
