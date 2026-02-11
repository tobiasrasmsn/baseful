# Baseful - Easy Installation

To make Baseful as easy to install as possible for your users, you should provide a single command that handles everything.

## 🚀 One-Command Install

You can host the `install.sh` script on your website or a GitHub Gist. Users can then run:

```bash
curl -sSL https://raw.githubusercontent.com/your-username/baseful/main/install.sh | bash
```

## 🛠 What's Included

I've created the following files to enable this auto-setup:

1.  **`install.sh`**: The main installer script.
2.  **`docker-compose.yml`**: Orchestrates the Backend, Frontend, and Proxy.
3.  **`backend/Dockerfile`**: Containerizes the Go API.
4.  **`frontend/Dockerfile`**: Containerizes the React Frontend.
5.  **`backend/.env.example`**: The environment template.

## 📝 The Magic Behind the Scenes

The `install.sh` script performs these "Zero Config" steps:
- **Auto-Security**: Generates a cryptographically secure 48-character `JWT_SECRET` automatically.
- **Auto-Networking**: Detects the machine's public IP and configures the Docker networks.
- **Dependency Guard**: Checks for Docker and Docker Compose before starting.
- **Persistence**: Re-uses existing `.env` files if they exist, so settings aren't lost on updates.

## 📡 Networking Notice
Since your're using **Tailscale**, your users can simply replace the `PUBLIC_IP` in the generated `.env` file with their Tailscale IP if they want to access it securely over their private network!
