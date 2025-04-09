ARG BUILD_FROM
FROM $BUILD_FROM

# Install Node.js and git only
RUN apk add --no-cache \
    nodejs npm \
    git bash

# Create git repo
RUN git init --bare /home/git/repos/my-hanode-project.git

# Set up the app directory first
WORKDIR /app

# Copy package.json and server.js
COPY package.json server.js /app/

# Install required Node.js packages
RUN npm install

# Copy root filesystem
COPY rootfs /

# Create git user and set permissions
RUN adduser -D git && \
    chown -R git:git /home/git/repos && \
    mkdir -p /var/www/hanode-app && \
    chown -R git:git /var/www && \
    chmod +x /home/git/repos/my-hanode-project.git/hooks/post-receive

# Expose HTTP port
EXPOSE 80
