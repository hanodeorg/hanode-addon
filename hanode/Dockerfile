ARG BUILD_FROM
FROM $BUILD_FROM

RUN apk add --no-cache \
    nodejs npm

COPY monitor /monitor

WORKDIR /monitor
RUN npm install
RUN npm run build

COPY rootfs /

EXPOSE 3003