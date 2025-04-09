#!/bin/bash

# This script sets up SSH keys for git access to the Hanode addon

# Create the SSH key (no passphrase)
echo "Creating SSH key..."
ssh-keygen -t rsa -b 2048 -f ~/.ssh/hanode_key -N ""

# Ensure correct permissions
chmod 600 ~/.ssh/hanode_key

# Extract public key
SSH_PUB_KEY=$(cat ~/.ssh/hanode_key.pub)

# Add SSH config entry
if ! grep -q "Host hanode" ~/.ssh/config 2>/dev/null; then
  echo "Adding SSH config entry..."
  cat >> ~/.ssh/config << EOF
Host hanode
    HostName localhost
    Port 7623
    User git
    IdentityFile ~/.ssh/hanode_key
    StrictHostKeyChecking no
    PreferredAuthentications publickey
    PasswordAuthentication no
EOF
  chmod 600 ~/.ssh/config
else
  echo "SSH config entry already exists."
fi

# Command to add SSH key to the addon
echo "Generated SSH public key to add to the addon:"
echo "$SSH_PUB_KEY"
echo
echo "Run this in a new terminal to add your key to the container:"
echo "docker exec -it addon_local_hanode bash -c \"mkdir -p /home/git/.ssh && echo '$SSH_PUB_KEY' > /home/git/.ssh/authorized_keys && chown -R git:git /home/git/.ssh && chmod 700 /home/git/.ssh && chmod 600 /home/git/.ssh/authorized_keys\""
echo
echo "Set up git remote with:"
echo "git remote set-url homeassistant ssh://hanode/home/git/repos/my-hanode-project.git"
echo
echo "Then push with:"
echo "git push --set-upstream homeassistant release"