# DigitalOcean Deployment

This project needs a real Node.js server for Express and Socket.IO. GitHub Pages can host only the static preview page, so the wedding game should run on a DigitalOcean Ubuntu Droplet.

## Recommended Droplet

- Region: Singapore, or the closest region to the venue
- Image: Ubuntu 24.04 LTS
- Size: 2 GB RAM / 1 vCPU
- Authentication: SSH key is preferred

## Bootstrap

SSH into the Droplet as root, then run:

```bash
curl -fsSL https://raw.githubusercontent.com/vbnmzxc9513/lucky_happy/main/deploy/bootstrap-ubuntu.sh -o bootstrap-ubuntu.sh
ADMIN_PASS='replace-with-a-strong-password' bash bootstrap-ubuntu.sh
```

After it finishes:

- Host screen: `http://DROPLET_IP/host`
- Guest phone: `http://DROPLET_IP/guest`
- Admin panel: `http://DROPLET_IP/admin`

The host and admin pages use Basic Auth. The default username is `admin`, and the password is the `ADMIN_PASS` value used during bootstrap.

## Update

Push changes to GitHub, then rerun the same bootstrap command on the Droplet. It will pull the latest `main`, run `npm ci`, and restart the service.

## Useful Commands

```bash
systemctl status lucky-horse
journalctl -u lucky-horse -f
systemctl restart lucky-horse
nginx -t
systemctl reload nginx
```

## Domain Later

If a domain is added later, set the DNS A record to the Droplet IP, update `SERVER_NAME`, then add HTTPS with Certbot.
