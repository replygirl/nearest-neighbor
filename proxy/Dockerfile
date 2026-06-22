# Stage 1: render nginx.conf from template using envsubst
FROM ubuntu:24.04 AS builder

RUN apt-get update && apt-get install -y --no-install-recommends gettext-base \
    && rm -rf /var/lib/apt/lists/*

COPY proxy/nginx.conf.template /nginx.conf.template

ARG SERVER_NAME=k.nearest-neighbor.replygirl.club
ARG PORT=8080
ARG POSTHOG_CLOUD_REGION=us

ENV SERVER_NAME=${SERVER_NAME}
ENV PORT=${PORT}
ENV POSTHOG_CLOUD_REGION=${POSTHOG_CLOUD_REGION}

RUN envsubst '$SERVER_NAME $POSTHOG_CLOUD_REGION $PORT' \
      < /nginx.conf.template > /nginx.conf

# Stage 2: minimal nginx image
FROM nginx:1.27-alpine

COPY --from=builder /nginx.conf /etc/nginx/nginx.conf

EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]
