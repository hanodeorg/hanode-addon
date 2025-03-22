ARG BUILD_FROM
FROM $BUILD_FROM

RUN \
  apk add --no-cache \
    nodejs npm

# Copy root filesystem
COPY rootfs /
