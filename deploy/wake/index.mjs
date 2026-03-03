/**
 * AWS Lambda – Wake/status function for the SpyFall EC2 instance.
 *
 * Deploy with a Lambda Function URL (auth: NONE) so it's a simple bookmark.
 * Set these environment variables on the Lambda:
 *   INSTANCE_ID  – e.g. i-0abc123def456789
 *   REGION       – e.g. us-east-1
 *   SECRET_TOKEN – any random string; callers must pass ?token=<SECRET_TOKEN>
 *                  (omit/leave blank to disable the check in a private network)
 *
 * Endpoints (all GET):
 *   ?action=start   – start the instance, return its public IP once running
 *   ?action=status  – return current state + public IP (default)
 *   ?action=stop    – stop the instance (use rarely – idle-shutdown handles this)
 */

import {
  EC2Client,
  StartInstancesCommand,
  StopInstancesCommand,
  DescribeInstancesCommand,
} from '@aws-sdk/client-ec2';

const ec2 = new EC2Client({ region: process.env.REGION ?? 'us-east-1' });
const INSTANCE_ID = process.env.INSTANCE_ID;
const SECRET_TOKEN = process.env.SECRET_TOKEN ?? '';

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

async function getInstanceInfo() {
  const res = await ec2.send(
    new DescribeInstancesCommand({ InstanceIds: [INSTANCE_ID] }),
  );
  const inst = res.Reservations[0].Instances[0];
  return {
    state: inst.State.Name,
    publicIp: inst.PublicIpAddress ?? null,
    publicDns: inst.PublicDnsName ?? null,
  };
}

export const handler = async (event) => {
  // Simple token gate – prevents random internet traffic from waking the instance.
  const params = event.queryStringParameters ?? {};
  if (SECRET_TOKEN && params.token !== SECRET_TOKEN) {
    return json(403, { error: 'Forbidden' });
  }

  if (!INSTANCE_ID) {
    return json(500, { error: 'INSTANCE_ID env var not set' });
  }

  const action = params.action ?? 'status';

  try {
    if (action === 'start') {
      await ec2.send(new StartInstancesCommand({ InstanceIds: [INSTANCE_ID] }));
      // Poll until the instance has a public IP (usually < 30 s).
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        const info = await getInstanceInfo();
        if (info.publicIp) return json(200, { action, ...info });
      }
      // Return even if IP not yet assigned.
      return json(200, { action, ...(await getInstanceInfo()) });
    }

    if (action === 'stop') {
      await ec2.send(new StopInstancesCommand({ InstanceIds: [INSTANCE_ID] }));
      return json(200, { action, state: 'stopping' });
    }

    // default: status
    return json(200, { action: 'status', ...(await getInstanceInfo()) });
  } catch (err) {
    console.error(err);
    return json(500, { error: err.message });
  }
};
