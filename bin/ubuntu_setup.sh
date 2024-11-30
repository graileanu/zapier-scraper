#!/bin/bash

# Function to check Ubuntu version
get_ubuntu_version() {
    if [ -f /etc/os-release ]; then
        . /etc/os-release
        echo "$VERSION_ID"
    else
        echo "unknown"
    fi
}

# Get Ubuntu version
UBUNTU_VERSION=$(get_ubuntu_version)
echo "Detected Ubuntu version: $UBUNTU_VERSION"

# Check if Node.js is installed
if ! command -v node &> /dev/null || ! command -v npm &> /dev/null; then
    echo "Node.js or npm not found. Installing Node.js..."
    # Clean up any existing Node.js installations
    sudo rm -f /etc/apt/sources.list.d/nodesource.list
    sudo rm -f /etc/apt/sources.list.d/nodesource.list.save
    
    # Install prerequisites
    sudo apt-get update
    sudo apt-get install -y ca-certificates curl gnupg
    
    # Add NodeSource repository
    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
    
    # Install Node.js
    sudo apt-get install -y nodejs
    
    # Verify installation
    echo "Node.js version: $(node --version)"
    echo "npm version: $(npm --version)"
else
    echo "Node.js is already installed"
    echo "Node.js version: $(node --version)"
    echo "npm version: $(npm --version)"
fi

# Function to determine package names based on Ubuntu version
get_package_list() {
    if [[ "$UBUNTU_VERSION" == "24.04" ]] || [[ "$UBUNTU_VERSION" == "noble" ]]; then
        # Noble (24.04) uses t64 packages
        echo "google-chrome-stable \
            libasound2t64 \
            libatk1.0-0t64 \
            libatk-bridge2.0-0t64 \
            libcairo2 \
            libcups2t64 \
            libdbus-1-3 \
            libexpat1 \
            libfontconfig1 \
            libgbm1 \
            libglib2.0-0t64 \
            libgtk-3-0t64 \
            libnspr4 \
            libpango-1.0-0 \
            libpangocairo-1.0-0 \
            libx11-6 \
            libx11-xcb1 \
            libxcb1 \
            libxcomposite1 \
            libxcursor1 \
            libxdamage1 \
            libxext6 \
            libxfixes3 \
            libxi6 \
            libxrandr2 \
            libxrender1 \
            libxss1 \
            libxtst6 \
            xvfb"
    else
        # Ubuntu 22.04 and earlier use standard package names
        echo "google-chrome-stable \
            libasound2 \
            libatk1.0-0 \
            libatk-bridge2.0-0 \
            libcairo2 \
            libcups2 \
            libdbus-1-3 \
            libexpat1 \
            libfontconfig1 \
            libgbm1 \
            libglib2.0-0 \
            libgtk-3-0 \
            libnspr4 \
            libpango-1.0-0 \
            libpangocairo-1.0-0 \
            libx11-6 \
            libx11-xcb1 \
            libxcb1 \
            libxcomposite1 \
            libxcursor1 \
            libxdamage1 \
            libxext6 \
            libxfixes3 \
            libxi6 \
            libxrandr2 \
            libxrender1 \
            libxss1 \
            libxtst6 \
            xvfb"
    fi
}

# Clean up any old Chrome installations
echo "Cleaning up old Chrome installations..."
sudo rm -f /etc/apt/sources.list.d/google-chrome.list
sudo rm -f /etc/apt/trusted.gpg.d/google-chrome*

# Update package list
echo "Updating package list..."
sudo apt update

# Install prerequisites
echo "Installing prerequisites..."
sudo apt install -y wget curl gnupg

# Add the new Chrome repository key (with force overwrite)
echo "Adding Chrome repository key..."
curl -fsSL https://dl.google.com/linux/linux_signing_key.pub | sudo gpg --yes --dearmor -o /usr/share/keyrings/google-chrome-archive-keyring.gpg

# Add the Chrome repository
echo "Adding Chrome repository..."
echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google-chrome-archive-keyring.gpg] http://dl.google.com/linux/chrome/deb/ stable main" | sudo tee /etc/apt/sources.list.d/google-chrome.list

# Update package list with new repository
echo "Updating package list with Chrome repository..."
sudo apt update

# Install Chrome and dependencies non-interactively
echo "Installing Chrome and dependencies..."
PACKAGES=$(get_package_list)
for package in $PACKAGES; do
    echo "Installing $package..."
    DEBIAN_FRONTEND=noninteractive sudo apt-get install -y --no-install-recommends $package || echo "Failed to install $package, continuing..."
done

# Verify Chrome installation
echo "Verifying Chrome installation..."
if google-chrome --version; then
    echo "Chrome installed successfully!"
else
    echo "Chrome installation verification failed!"
    exit 1
fi

# Set up Xvfb
echo "Setting up Xvfb..."
if ! pgrep Xvfb > /dev/null; then
    Xvfb :99 -screen 0 1920x1080x24 > /dev/null 2>&1 &
    echo "export DISPLAY=:99" >> ~/.bashrc
    export DISPLAY=:99
    echo "Xvfb started on display :99"
else
    echo "Xvfb is already running"
fi

echo "Setup completed!"