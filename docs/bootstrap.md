# Bootstrapping a deployment

What tagalong needs before it answers anyone, made once, by hand, in this order. The repo names each thing by the name given here and holds no values ([public-repo.md](constraints/public-repo.md)). For working on the code, see [setup.md](setup.md).

## 1. AWS

1. Make an AWS account that holds tagalong and nothing else. Work in `us-east-1`: CloudWatch's billing metric exists only there.
2. Under Billing preferences, switch on billing alerts, or the spend alarm never fires.
3. In Parameter Store, Standard tier, in `us-east-1`, make three String parameters:
   - `/tagalong/alerts/email`: the address alerts go to.
   - `/tagalong/alerts/monthly-spend`: the monthly bill in US dollars that sets off the spend alarm, such as `15`.
   - `/tagalong/owners`: the owners' phone numbers, digits only with the country code, separated by commas. Owners set groups up from WhatsApp.

## 2. The Claude login

Sessions start from a claude.ai login that tagalong uses alone ([claude-login.md](constraints/claude-login.md)). Sign in with the account whose cloud environments and GitHub access the sessions should use. A sign-in of your own account is fine: each sign-in is its own login, so this one never interferes with your laptop's.

From a checkout, after `npm ci`, with AWS credentials for the account:

```
node scripts/mint-claude-login.ts --profile <aws profile>
```

It signs in under a throwaway folder, stores the login as the SecureString `/tagalong/claude-login`, and removes the folder. Run it again only if an alert says the login is dead.

## 3. GitHub

1. Make the public repo `t-d-d/tagalong` and push this code to main. Its first deploy run fails, since nothing below exists yet.
2. Read its numeric ids: `gh api repos/t-d-d/tagalong --jq '.owner.id, .id'`.
3. Apply [infra/github-oidc.cfn.yml](../infra/github-oidc.cfn.yml) once by hand, as the stack `tagalong` in `us-east-1`. It makes GitHub's OIDC provider and the role `tagalong-github-deploy`, which only a job on main can assume. Each deploy applies it again after that.

   ```
   aws cloudformation deploy --region us-east-1 --stack-name tagalong \
     --template-file infra/github-oidc.cfn.yml --capabilities CAPABILITY_NAMED_IAM \
     --parameter-overrides GitHubOwnerId=<owner id> GitHubRepoId=<repo id>
   ```

4. Set the repo variables `AWS_DEPLOY_ROLE_ARN` (the stack's output) and `AWS_REGION` (`us-east-1`). There are no secrets to set.
5. Give main a ruleset that requires a pull request and the `gate` check.

## 4. The first deploy

In the Actions tab, re-run the failed deploy run on main. It builds the three images, makes the stacks `tagalong-images` and `tagalong-app`, and waits for the task's first heartbeat. The task starts without a device, so its heartbeat says `waiting-for-device` and the no-heartbeat alarm is on until step 5.

Confirm the alert email: AWS sends a link from `no-reply@sns.amazonaws.com`. No alarm reaches anyone until it is clicked, and it lasts three days.

## 5. Moving the device

The WhatsApp device is paired on a laptop with the bridge, and moved once ([one-device.md](constraints/one-device.md)). If it is not paired yet, run the bridge from [whatsapp-mcp](https://github.com/verygoodplugins/whatsapp-mcp) at the commit in [images/bridge.Dockerfile](../images/bridge.Dockerfile), scan its QR code from the phone under Linked devices, then stop it.

1. Stop the bridge and anything else using it on the laptop.
2. From a checkout, after `npm ci`, with AWS credentials for the account:

   ```
   node scripts/move-device.ts --store <the bridge's store folder> \
     --groups <groups.json> --state <state.json> --profile <aws profile>
   ```

   `--groups` and `--state` are optional: give them to carry over groups already set up and sessions still waiting.

3. It uploads the device, waits for the task to take it, and renames the store on the laptop so the bridge there cannot start with it again. Within a few minutes the heartbeat says `connected` and the alarm clears.

Never start a bridge anywhere else with that device: two bridges on one device get it logged out.

## 6. Trying it

In a group, from an owner's phone, send `@claude help`. Define a Claude with the `define` message it sends back, edited for your repo, then `@claude add` it. Then ask it something by name. Groups carried over from the laptop already have a Claude each, named after their repo.

To check that an alarm reaches you, run this in CloudShell in `us-east-1`:

```
aws cloudwatch set-alarm-state --alarm-name tagalong-error-lines \
  --state-value ALARM --state-reason "Checking the alert email arrives"
```
