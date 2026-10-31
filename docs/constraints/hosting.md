# Hosting
Relevance: The task, the service, the volume, the bucket, the network, the images or the upload link: infra/app.cfn.yml, infra/images.cfn.yml, images/**, scripts/deploy.sh
Decision: One always-on Fargate Spot task, arm64, holding the bridge and tagalong, with its state on one encrypted EFS volume, in the account's default VPC.

Why: WhatsApp delivers to a linked device that stays connected, so
something must always run. One small Spot task costs a few dollars a
month, and EFS keeps the device across tasks.

## Rules

- The service runs exactly one task, 0.25 vCPU and 1 GB, on
  FARGATE_SPOT, arm64.
- A deploy stops the old task before starting the new one: minimum
  healthy 0%, maximum 100%. Two tasks never run at once (one-device.md).
- The deployment circuit breaker rolls back a task that cannot start.
- Both containers mount the volume at /data, through an access point
  that makes every file uid and gid 1000. The bridge works in
  /data/bridge, tagalong keeps its HOME in /data/home.
- The volume is encrypted, backed up daily, and kept when the stack is
  deleted. Transit is encrypted and mounts are authorised by IAM.
- The task has a public IP for outbound traffic and its security group
  allows no inbound traffic. The bridge's API and the webhook listen on
  127.0.0.1 inside the task.
- The bucket blocks all public access, refuses plain HTTP, and expires
  every object after a day.
- The upload link (attachments.md) is one Lambda, arm64, from its own
  image, behind an API Gateway HTTP API whose one route,
  GET /up/{id}/{name}, is throttled to 5 requests a second with bursts
  of 10. It holds no state, and the task never waits on it. Its lines
  go to /tagalong, with Lambda's own START, END and REPORT lines, which
  carry only request ids and timings.
- ECS Exec is on, for the operator's commands (docs/setup.md).
- Images live in the stack's ECR repositories, tagged immutably.

## Do not

- Run the service on Lambda, or start it on demand: the device must
  stay connected to receive messages as they arrive, and a request must
  not wait for a task to start. The upload link is the one Lambda,
  because it holds nothing and nothing waits on it.
- Add a NAT gateway or a load balancer: each costs more than the task.
- Put the device in the image or in S3 for good: it is a login.

History: Set when the repo was made, October 2026. The upload link's
Lambda and HTTP API since 31 October 2026, at the owner's request (#59).
