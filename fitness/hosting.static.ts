import { describe, expect, it } from "vitest";
import { z } from "zod";
import { readRepoFile } from "../test/repo.ts";
import { appStack, only, resourcesOf } from "../test/stack.ts";

describe("fitness: one Spot task, never two at once (hosting.md, one-device.md)", () => {
  it("runs one task on FARGATE_SPOT, stopping the old before starting the new", () => {
    const service = z
      .object({
        DesiredCount: z.literal(1),
        CapacityProviderStrategy: z.tuple([
          z.object({ CapacityProvider: z.literal("FARGATE_SPOT") }),
        ]),
        DeploymentConfiguration: z.object({
          MinimumHealthyPercent: z.literal(0),
          MaximumPercent: z.literal(100),
          DeploymentCircuitBreaker: z.object({
            Enable: z.literal(true),
            Rollback: z.literal(true),
          }),
        }),
        EnableExecuteCommand: z.literal(true),
      })
      .safeParse(only("AWS::ECS::Service"));
    expect(service.error?.issues ?? []).toEqual([]);
  });

  it("is a small arm64 task whose two containers share the volume at /data", () => {
    const task = z
      .object({
        Cpu: z.literal("256"),
        Memory: z.literal("1024"),
        RuntimePlatform: z.object({ CpuArchitecture: z.literal("ARM64") }),
        ContainerDefinitions: z.array(
          z.object({
            Name: z.string(),
            MountPoints: z.tuple([
              z.object({ ContainerPath: z.literal("/data") }),
            ]),
          }),
        ),
      })
      .parse(only("AWS::ECS::TaskDefinition"));
    expect(
      task.ContainerDefinitions.map((container) => container.Name).sort(),
    ).toEqual(["app", "bridge"]);
  });
});

describe("fitness: nothing reaches the task from outside (hosting.md)", () => {
  it("gives the task's security group no inbound rule", () => {
    const groups = resourcesOf("AWS::EC2::SecurityGroup");
    const task = groups.find((group) => group.name === "TaskSecurityGroup");
    expect(task?.properties.SecurityGroupIngress).toBeUndefined();
    expect(resourcesOf("AWS::EC2::SecurityGroupIngress")).toEqual([]);
    expect(resourcesOf("AWS::ElasticLoadBalancingV2::LoadBalancer")).toEqual(
      [],
    );
  });

  it("lets only the task reach the volume, over NFS", () => {
    const volume = resourcesOf("AWS::EC2::SecurityGroup").find(
      (group) => group.name === "VolumeSecurityGroup",
    );
    expect(volume?.properties.SecurityGroupIngress).toEqual([
      {
        IpProtocol: "tcp",
        FromPort: 2049,
        ToPort: 2049,
        SourceSecurityGroupId: { Ref: "TaskSecurityGroup" },
      },
    ]);
  });
});

describe("fitness: the volume is kept, encrypted and backed up (hosting.md)", () => {
  it("is encrypted, backed up and retained", () => {
    const volumes = Object.values(appStack().Resources).filter(
      (resource) => resource.Type === "AWS::EFS::FileSystem",
    );
    expect(volumes).toHaveLength(1);
    expect(volumes[0]).toMatchObject({
      DeletionPolicy: "Retain",
      UpdateReplacePolicy: "Retain",
      Properties: { Encrypted: true, BackupPolicy: { Status: "ENABLED" } },
    });
  });

  it("is mounted with transit encryption and IAM, as uid 1000", () => {
    const task = z
      .object({
        Volumes: z.tuple([
          z.object({
            EFSVolumeConfiguration: z.object({
              TransitEncryption: z.literal("ENABLED"),
              AuthorizationConfig: z.object({ IAM: z.literal("ENABLED") }),
            }),
          }),
        ]),
      })
      .safeParse(only("AWS::ECS::TaskDefinition"));
    expect(task.error?.issues ?? []).toEqual([]);
    expect(only("AWS::EFS::AccessPoint")).toMatchObject({
      PosixUser: { Uid: "1000", Gid: "1000" },
    });
  });
});

describe("fitness: the bucket is private and forgets (attachments.md)", () => {
  it("blocks public access, refuses plain HTTP and expires everything after a day", () => {
    const bucket = only("AWS::S3::Bucket");
    expect(bucket.PublicAccessBlockConfiguration).toEqual({
      BlockPublicAcls: true,
      BlockPublicPolicy: true,
      IgnorePublicAcls: true,
      RestrictPublicBuckets: true,
    });
    expect(bucket.LifecycleConfiguration).toMatchObject({
      Rules: [{ Status: "Enabled", ExpirationInDays: 1 }],
    });
    expect(JSON.stringify(only("AWS::S3::BucketPolicy"))).toContain(
      '"aws:SecureTransport":"false"',
    );
  });
});

describe("fitness: the task can tell a missing upload from a refusal (one-device.md)", () => {
  it("may list the bucket, so S3 answers not found rather than access denied", () => {
    expect(JSON.stringify(resourcesOf("AWS::IAM::Role"))).toContain(
      '{"Effect":"Allow","Action":"s3:ListBucket","Resource":{"Fn::GetAtt":["Bucket","Arn"]}}',
    );
  });
});

describe("fitness: the task may only run its own transcription jobs (attachments.md)", () => {
  it("may start, read and delete transcription jobs, and do nothing else in Transcribe", () => {
    const roles = JSON.stringify(resourcesOf("AWS::IAM::Role"));
    const statements = roles.match(
      /\{"Effect":"Allow","Action":[^{}]*transcribe:[^{}]*"Resource":\{"Fn::Sub":"[^"]*"\}\}/gu,
    );
    expect(roles.match(/"transcribe:/gu)).toHaveLength(3);
    expect(statements).toEqual([
      '{"Effect":"Allow","Action":["transcribe:StartTranscriptionJob","transcribe:GetTranscriptionJob","transcribe:DeleteTranscriptionJob"],"Resource":{"Fn::Sub":"arn:${AWS::Partition}:transcribe:${AWS::Region}:${AWS::AccountId}:transcription-job/tagalong-*"}}',
    ]);
  });
});

describe("fitness: a session's uploads stay in its own folder (attachments.md)", () => {
  const policiesSchema = z.object({
    Policies: z.array(
      z.object({
        PolicyDocument: z.object({
          Statement: z.array(
            z.object({
              Effect: z.string(),
              Action: z.union([z.string(), z.array(z.string())]),
              Resource: z.unknown(),
            }),
          ),
        }),
      }),
    ),
  });

  /** A role's S3 statements, each as JSON. */
  const s3Of = (role: string) =>
    resourcesOf("AWS::IAM::Role")
      .filter((each) => each.name === role)
      .flatMap((each) => policiesSchema.parse(each.properties).Policies)
      .flatMap((policy) => policy.PolicyDocument.Statement)
      .filter((statement) =>
        [statement.Action].flat().some((action) => action.startsWith("s3:")),
      )
      .map((statement) => JSON.stringify(statement));

  it("lets the task read what landed and keep links working, but not upload", () => {
    expect(s3Of("TaskRole")).toEqual(
      expect.arrayContaining([
        '{"Effect":"Allow","Action":"s3:GetObject","Resource":{"Fn::Sub":"${Bucket.Arn}/outgoing/*"}}',
        '{"Effect":"Allow","Action":"s3:PutObject","Resource":{"Fn::Sub":"${Bucket.Arn}/links/*"}}',
      ]),
    );
    expect(
      s3Of("TaskRole").filter(
        (statement) =>
          statement.includes("outgoing") && statement.includes("PutObject"),
      ),
    ).toEqual([]);
  });

  it("lets the upload link read markers and sign uploads to outgoing/*, and nothing else in the bucket", () => {
    expect(s3Of("LinkRole")).toEqual([
      '{"Effect":"Allow","Action":"s3:GetObject","Resource":{"Fn::Sub":"${Bucket.Arn}/links/*"}}',
      '{"Effect":"Allow","Action":"s3:ListBucket","Resource":{"Fn::GetAtt":["Bucket","Arn"]}}',
      '{"Effect":"Allow","Action":"s3:PutObject","Resource":{"Fn::Sub":"${Bucket.Arn}/outgoing/*"}}',
    ]);
  });
});

describe("fitness: the upload link is one small Lambda, throttled, that logs where the alarm reads (hosting.md, alerting.md)", () => {
  it("runs from its own arm64 image and logs to /tagalong", () => {
    expect(only("AWS::Lambda::Function")).toMatchObject({
      PackageType: "Image",
      Code: { ImageUri: { Ref: "LinkImage" } },
      Architectures: ["arm64"],
      LoggingConfig: { LogGroup: { Ref: "LogGroup" } },
    });
  });

  it("answers GET /up/{id}/{name} only, throttled", () => {
    expect(only("AWS::ApiGatewayV2::Api")).toMatchObject({
      ProtocolType: "HTTP",
      RouteKey: "GET /up/{id}/{name}",
      Target: { "Fn::GetAtt": ["LinkFunction", "Arn"] },
    });
    expect(only("AWS::ApiGatewayV2::ApiGatewayManagedOverrides")).toMatchObject(
      {
        Stage: {
          DefaultRouteSettings: {
            ThrottlingBurstLimit: 10,
            ThrottlingRateLimit: 5,
          },
        },
      },
    );
  });

  it("gives the task the link's address", () => {
    expect(readRepoFile("infra/app.cfn.yml")).toMatch(
      /- Name: UPLOAD_LINK\n\s+Value: !Sub "\$\{LinkApi\.ApiEndpoint\}\/up\/"/u,
    );
  });
});

describe("fitness: phone numbers never sit in the task definition (public-repo.md)", () => {
  it("reads the owners from Parameter Store as a secret", () => {
    const task = readRepoFile("infra/app.cfn.yml");
    expect(task).toMatch(
      /- Name: OWNERS\n\s+ValueFrom: .*parameter\/tagalong\/owners/u,
    );
  });
});
