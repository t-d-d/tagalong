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

# Build and push an image unless its tag is already there.
image() {
  local uri=$1 tag=$2 dockerfile=$3
  local repo=${uri#*/}
  if aws ecr describe-images --repository-name "$repo" --image-ids "imageTag=$tag" > /dev/null 2>&1; then
    echo "$repo:$tag is already pushed" >&2
  else
    docker build --platform linux/arm64 --file "$dockerfile" --tag "$uri:$tag" . >&2
    docker push "$uri:$tag" >&2
  fi
  echo "$uri:$tag"
}

role() {
  aws cloudformation deploy \
    --stack-name tagalong \
    --template-file infra/github-oidc.cfn.yml \
    --capabilities CAPABILITY_NAMED_IAM \
    --no-fail-on-empty-changeset \
    --parameter-overrides \
    "GitHubOwnerId=${GITHUB_REPOSITORY_OWNER_ID:?}" \
    "GitHubRepoId=${GITHUB_REPOSITORY_ID:?}"
}

app() {
  aws cloudformation deploy \
    --stack-name tagalong-images \
    --template-file infra/images.cfn.yml \
    --no-fail-on-empty-changeset

  local bridge_uri app_uri
  bridge_uri=$(output tagalong-images BridgeRepositoryUri)
  app_uri=$(output tagalong-images AppRepositoryUri)
  aws ecr get-login-password | docker login --username AWS --password-stdin "${bridge_uri%%/*}"

  local bridge_image app_image
  bridge_image=$(image "$bridge_uri" "$(hash_of images/bridge.Dockerfile images/bridge-start.sh)" images/bridge.Dockerfile)
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

  aws cloudformation deploy \
    --stack-name tagalong-app \
    --template-file infra/app.cfn.yml \
    --capabilities CAPABILITY_IAM \
    --no-fail-on-empty-changeset \
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
