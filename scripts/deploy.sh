#!/bin/bash
# The deploy, run by .github/workflows/deploy.yml on a green merge to main and
# by its rollback at live-ok (repo-and-delivery.md). Never run it by hand.
#
#   scripts/deploy.sh role   the deploy role's own stack, tagalong
#   scripts/deploy.sh app    the images, then the stack tagalong-app
#   scripts/deploy.sh live   wait for the new task's first heartbeat
#
# Needs AWS credentials for the account, and for role the repo's numeric ids
# in GITHUB_REPOSITORY_OWNER_ID and GITHUB_REPOSITORY_ID.
set -euo pipefail
# Bash drops set -e inside a command substitution unless told to keep it, and
# the images are built inside one (#32).
shopt -s inherit_errexit

cd "$(dirname "$0")/.."
summary=${GITHUB_STEP_SUMMARY:-/dev/null}

output() {
  aws cloudformation describe-stacks --stack-name "$1" \
    --query "Stacks[0].Outputs[?OutputKey=='$2'].OutputValue" --output text
}

# An image's tag: a hash of the files it is built from, as git stores them,
# so an unchanged image is never rebuilt and a rollback finds its old one.
hash_of() {
  git ls-files -s -- "$@" | grep -vE '\.(test|int)\.ts$' | sha256sum | cut -d' ' -f1
}

# Build and push an image unless its tag is already there. Only ECR's
# ImageNotFoundException says it is not. Any other failed lookup, such as
# throttling or a missing permission, says nothing about the image, and a
# rebuild would only be refused at the push, since tags are immutable (#46).
image() {
  local uri=$1 tag=$2 dockerfile=$3
  local repo=${uri#*/} lookup
  if lookup=$(aws ecr describe-images --repository-name "$repo" --image-ids "imageTag=$tag" 2>&1 > /dev/null); then
    echo "$repo:$tag is already pushed" >&2
  elif [[ $lookup == *ImageNotFoundException* ]]; then
    docker build --platform linux/arm64 --file "$dockerfile" --tag "$uri:$tag" . >&2 || { echo "Building $repo:$tag failed." | tee -a "$summary" >&2; return 1; }
    docker push "$uri:$tag" >&2 || { echo "Pushing $repo:$tag failed." | tee -a "$summary" >&2; return 1; }
  else
    # The error's class only, a name or, when the service sent none, an
    # HTTP status. Its message can name the account, and the run's log is
    # public.
    local class=unknown pattern='An error occurred \(([A-Za-z0-9]+)\)'
    if [[ $lookup =~ $pattern ]]; then class=${BASH_REMATCH[1]}; fi
    echo "Looking up $repo:$tag in ECR failed ($class)." | tee -a "$summary" >&2
    return 1
  fi
  echo "$uri:$tag"
}

# Say why a stack failed: CloudFormation's reason for each resource that
# did, in the log and the run's summary.
why() {
  {
    echo "$1 failed. CloudFormation's reason for each resource that did:"
    aws cloudformation describe-stack-events --stack-name "$1" --max-items 50 \
      --query "StackEvents[?ends_with(ResourceStatus, '_FAILED')].[LogicalResourceId, ResourceStatusReason]" \
      --output text | sed 's/\t/: /; s/^/- /'
  } | tee -a "$summary" >&2
}

# Apply a stack, saying why if it fails. A stack whose first create rolled
# back cannot be updated, only deleted, and holds nothing yet, so it goes.
apply() {
  local stack=$1
  shift
  local status
  status=$(aws cloudformation describe-stacks --stack-name "$stack" \
    --query "Stacks[0].StackStatus" --output text 2> /dev/null || echo NONE)
  if [ "$status" = ROLLBACK_COMPLETE ]; then
    echo "$stack is ROLLBACK_COMPLETE from a first create that failed; deleting it before trying again." >&2
    aws cloudformation delete-stack --stack-name "$stack"
    aws cloudformation wait stack-delete-complete --stack-name "$stack"
  fi
  if ! aws cloudformation deploy --stack-name "$stack" --no-fail-on-empty-changeset "$@"; then
    why "$stack"
    exit 1
  fi
}

role() {
  apply tagalong \
    --template-file infra/github-oidc.cfn.yml \
    --capabilities CAPABILITY_NAMED_IAM \
    --parameter-overrides \
    "GitHubOwnerId=${GITHUB_REPOSITORY_OWNER_ID:?}" \
    "GitHubRepoId=${GITHUB_REPOSITORY_ID:?}"
}

app() {
  apply tagalong-images --template-file infra/images.cfn.yml

  local bridge_uri app_uri
  bridge_uri=$(output tagalong-images BridgeRepositoryUri)
  app_uri=$(output tagalong-images AppRepositoryUri)
  aws ecr get-login-password | docker login --username AWS --password-stdin "${bridge_uri%%/*}"
  # The base images come from ECR Public, which holds anonymous pulls to a
  # lower limit, counted by address and shared by GitHub's runners (#33).
  # Its login is issued only in us-east-1, whatever the stack's region. A
  # failed login leaves the pulls anonymous, as before, so a deploy or
  # rollback whose images are already pushed does not stop on it.
  aws ecr-public get-login-password --region us-east-1 | docker login --username AWS --password-stdin public.ecr.aws || echo "Logging in to ECR Public failed, so base images are pulled anonymously." | tee -a "$summary" >&2

  local bridge_image app_image
  bridge_image=$(image "$bridge_uri" "$(hash_of images/bridge.Dockerfile images/bridge-start.sh images/bridge.patch)" images/bridge.Dockerfile)
  app_image=$(image "$app_uri" "$(hash_of images/tagalong.Dockerfile .dockerignore package.json package-lock.json service)" images/tagalong.Dockerfile)

  # The default VPC's first two zones, by zone id, so the volume's mount
  # targets stay put from one deploy to the next.
  local vpc subnets
  vpc=$(aws ec2 describe-vpcs --filters Name=is-default,Values=true --query 'Vpcs[0].VpcId' --output text)
  read -r -a subnets <<< "$(aws ec2 describe-subnets \
    --filters "Name=vpc-id,Values=$vpc" Name=default-for-az,Values=true \
    --query 'sort_by(Subnets, &AvailabilityZoneId)[:2].SubnetId' --output text)"
  if [ "$vpc" = None ] || [ "${#subnets[@]}" -lt 2 ]; then
    echo "The account needs its default VPC, with default subnets in two zones (docs/bootstrap.md)." >&2
    exit 1
  fi

  # A new account has no ECS service-linked role until something makes one,
  # and the cluster cannot be created without it.
  if ! aws iam get-role --role-name AWSServiceRoleForECS > /dev/null 2>&1; then
    aws iam create-service-linked-role --aws-service-name ecs.amazonaws.com > /dev/null
    aws iam wait role-exists --role-name AWSServiceRoleForECS
    sleep 20 # IAM takes a moment to show a new role to ECS.
  fi

  apply tagalong-app \
    --template-file infra/app.cfn.yml \
    --capabilities CAPABILITY_IAM \
    --parameter-overrides \
    "VpcId=$vpc" "SubnetA=${subnets[0]}" "SubnetB=${subnets[1]}" \
    "BridgeImage=$bridge_image" "AppImage=$app_image"
  echo "Deployed $app_image and $bridge_image" >> "$summary"
}

# The live check: the task running the stack's task definition writes a
# heartbeat line within ten minutes.
live() {
  local definition cluster deadline task line
  definition=$(output tagalong-app TaskDefinitionArn)
  cluster=$(output tagalong-app ClusterName)
  deadline=$((SECONDS + 600))
  while [ "$SECONDS" -lt "$deadline" ]; do
    task=$(aws ecs list-tasks --cluster "$cluster" --desired-status RUNNING --query 'taskArns' --output text | tr '\t' '\n' | while read -r arn; do
      [ -n "$arn" ] || continue
      if [ "$(aws ecs describe-tasks --cluster "$cluster" --tasks "$arn" --query 'tasks[0].taskDefinitionArn' --output text)" = "$definition" ]; then
        echo "${arn##*/}"
      fi
    done | head -1)
    if [ -n "$task" ]; then
      line=$(aws logs filter-log-events --log-group-name /tagalong \
        --log-stream-names "app/app/$task" \
        --filter-pattern '{ $.event = "heartbeat" }' \
        --query 'events[0].message' --output text 2> /dev/null || true)
      if [ -n "$line" ] && [ "$line" != None ]; then
        echo "Live: task $task wrote $line" | tee -a "$summary"
        return 0
      fi
    fi
    sleep 15
  done
  echo "No heartbeat from a task running $definition within ten minutes." | tee -a "$summary" >&2
  exit 1
}

case "${1:-}" in
  role) role ;;
  app) app ;;
  live) live ;;
  *)
    echo "usage: scripts/deploy.sh role|app|live" >&2
    exit 2
    ;;
esac
