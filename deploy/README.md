# Deploying SpyFall to AWS EC2

This guide sets up a single `t3.micro` EC2 instance that:
- **Starts automatically** on boot (systemd)
- **Shuts itself down** after 30 minutes with no players
- Can be **started remotely** via a bookmarkable Lambda URL

---

## 1. Launch the EC2 Instance

1. Open EC2 → **Launch Instance**
2. Settings:
   - **AMI**: Ubuntu Server 22.04 LTS (x86_64)
   - **Instance type**: `t3.micro` (2 vCPU, 1 GB RAM – free tier eligible)
   - **Key pair**: create or select one (you'll need the `.pem` file to SSH in)
   - **Security group** – create a new one with inbound rules:
     | Type | Protocol | Port | Source |
     |------|----------|------|--------|
     | HTTP | TCP | 80 | 0.0.0.0/0 (game traffic) |
     | SSH  | TCP | 22 | Your IP only |
   - **Storage**: 8 GB gp3 is fine
3. Launch the instance. Note the **instance ID** (e.g. `i-0abc123def456789`).

---

## 2. Allocate an Elastic IP (fixed address)

Without an Elastic IP the public IP changes every time the instance starts.

1. EC2 → **Elastic IPs** → **Allocate Elastic IP address** → Allocate
2. Select the new address → **Actions → Associate Elastic IP**
3. Choose your instance → Associate

Your game will always be reachable at this IP (e.g. `http://54.1.2.3`).
Cost: free while the instance is running, ~$0.005/hr while stopped.

---

## 3. Copy the App to the Instance

From your local machine, `rsync` the project (exclude dev files):

```sh
rsync -avz --exclude 'node_modules' --exclude 'frontend/dist' --exclude '.git' \
  /infrastructure/nambar/spyfall/ \
  ubuntu@<ELASTIC_IP>:~/spyfall/
```

---

## 4. Run the Setup Script

SSH in and run the one-time setup:

```sh
ssh -i ~/.ssh/your-key.pem ubuntu@<ELASTIC_IP>
bash ~/spyfall/deploy/setup.sh
```

This will:
- Install Node.js 22
- Build the frontend (`frontend/dist/`)
- Install and start the `spyfall` systemd service (auto-starts on every boot)
- Grant the process permission to call `sudo shutdown`

After setup, open `http://<ELASTIC_IP>` in a browser – the game should load.

### Useful commands on the instance

```sh
sudo journalctl -fu spyfall          # live logs
sudo systemctl status spyfall        # service status
sudo systemctl restart spyfall       # restart (after updating code)
```

### Updating the code

```sh
# 1. From your local machine, rsync again:
rsync -avz --exclude 'node_modules' --exclude 'frontend/dist' --exclude '.git' \
  /infrastructure/nambar/spyfall/ ubuntu@<ELASTIC_IP>:~/spyfall/

# 2. SSH in and rebuild + restart:
ssh ubuntu@<ELASTIC_IP>
cd ~/spyfall && npm run build
sudo systemctl restart spyfall
```

---

## 5. How Auto-Shutdown Works

The server tracks Socket.io connections. When the last player disconnects:
- A 30-minute countdown starts (logged as `[idle] No active connections…`)
- If no one reconnects within 30 minutes, the process calls `sudo shutdown -h now`
- The instance stops → billing pauses

The countdown also starts immediately on boot, so if you start the instance but
nobody joins within 30 minutes, it shuts down automatically.

To change the timeout, edit the systemd service:
```ini
Environment=IDLE_SHUTDOWN_MINUTES=60
```
Then `sudo systemctl daemon-reload && sudo systemctl restart spyfall`.

---

## 6. Remote Start via Lambda (bookmarkable wake URL)

This lets you start the instance from a phone browser or share a link with friends.

### Create an IAM role for the Lambda

1. IAM → **Roles** → Create role
2. Trusted entity: **Lambda**
3. Attach policy: **AmazonEC2FullAccess** (or create a minimal policy with `ec2:StartInstances`, `ec2:StopInstances`, `ec2:DescribeInstances`)
4. Name it `spyfall-wake-role`

### Deploy the Lambda

1. Lambda → **Create function**
   - Runtime: **Node.js 22.x**
   - Architecture: x86_64
   - Execution role: `spyfall-wake-role`
2. Upload `deploy/wake/index.mjs` as the function code
   (paste it directly into the inline editor, or zip and upload)
3. Set **Environment variables**:
   | Key | Value |
   |-----|-------|
   | `INSTANCE_ID` | `i-0abc123def456789` |
   | `REGION` | `us-east-1` (or your region) |
   | `SECRET_TOKEN` | any random string, e.g. `hunter2` |
4. **Configuration → Function URL** → Create function URL → Auth type: **NONE**
   (the `SECRET_TOKEN` provides lightweight protection)
5. Copy the Function URL (looks like `https://abc123.lambda-url.us-east-1.on.aws/`)

### Using the wake URL

Bookmark this in your browser / share with friends:

```
https://<FUNCTION_URL>?action=start&token=<SECRET_TOKEN>
```

Response example:
```json
{ "action": "start", "state": "running", "publicIp": "54.1.2.3" }
```

The Lambda polls until the instance has a public IP, so the response arrives
when the instance is ready (~15–30 seconds). Then navigate to `http://54.1.2.3`.

If you use an **Elastic IP** (recommended), the IP is always the same, so you
can just bookmark `http://<ELASTIC_IP>` directly and wake via the Lambda first.

Other actions:
```
?action=status&token=...   # check state + IP without starting
?action=stop&token=...     # force-stop (normally not needed)
```

### Alternative: AWS CLI

If you just want to start/stop from a terminal:

```sh
# Start
aws ec2 start-instances --instance-ids i-0abc123def456789 --region us-east-1

# Check IP
aws ec2 describe-instances --instance-ids i-0abc123def456789 \
  --query 'Reservations[0].Instances[0].PublicIpAddress' --output text

# Stop (manual)
aws ec2 stop-instances --instance-ids i-0abc123def456789
```

---

## Cost Estimate

| Resource | Cost |
|----------|------|
| t3.micro (running) | ~$0.0104/hr (~$7.50/mo if on 24/7) |
| t3.micro (stopped) | $0/hr |
| Elastic IP (stopped) | ~$0.005/hr |
| Lambda invocations | essentially free |
| EBS 8 GB gp3 | ~$0.64/mo |

If you play 2 hours/day on average, the instance runs ~60 hr/mo → **~$0.62/mo** in compute.
