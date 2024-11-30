# First remove any old keys/repositories if they exist
sudo rm -f /etc/apt/sources.list.d/google-chrome.list
sudo rm -f /etc/apt/trusted.gpg.d/google-chrome*

# Update package list
sudo apt update

# Install prerequisites
sudo apt install -y wget curl gnupg

# Add the new Chrome repository key
curl -fsSL https://dl.google.com/linux/linux_signing_key.pub | sudo gpg --dearmor -o /usr/share/keyrings/google-chrome-archive-keyring.gpg

# Add the Chrome repository
echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google-chrome-archive-keyring.gpg] http://dl.google.com/linux/chrome/deb/ stable main" | sudo tee /etc/apt/sources.list.d/google-chrome.list

# Update package list with new repository
sudo apt update

# Install Chrome and dependencies
sudo apt install -y \
    google-chrome-stable \
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
    xvfb

# Verify Chrome installation
google-chrome --version