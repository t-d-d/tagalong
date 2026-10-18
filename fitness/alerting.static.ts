import { describe, expect, it } from "vitest";
import { z } from "zod";
import { events } from "../service/src/log.ts";
import { appStack, resourcesOf } from "../test/stack.ts";

const alarmSchema = z.looseObject({
  AlarmName: z.string(),
  MetricName: z.string(),
  Threshold: z.unknown(),
  ComparisonOperator: z.string(),
  TreatMissingData: z.string(),
  AlarmActions: z.array(z.object({ Ref: z.literal("AlertTopic") })),
});

const alarms = () =>
  resourcesOf("AWS::CloudWatch::Alarm").map((alarm) =>
    alarmSchema.parse(alarm.properties),
  );
const filters = () =>
  resourcesOf("AWS::Logs::MetricFilter").map((filter) =>
    z
      .object({
        FilterPattern: z.string(),
        MetricTransformations: z.tuple([z.object({ MetricName: z.string() })]),
      })
      .parse(filter.properties),
  );

describe("fitness: three alarms, all to the owner (alerting.md)", () => {
  it("has the error-lines, no-heartbeat and spend alarms, each emailing the alert topic", () => {
    expect(
      alarms()
        .map((alarm) => alarm.AlarmName)
        .sort(),
    ).toEqual([
      "tagalong-error-lines",
      "tagalong-no-heartbeat",
      "tagalong-spend",
    ]);
    expect(Object.keys(appStack().Resources)).toContain("AlertSubscription");
  });

  it("counts error lines, and alarms on any", () => {
    const filter = filters().find(
      (found) => found.MetricTransformations[0].MetricName === "ErrorLines",
    );
    expect(filter?.FilterPattern).toBe('{ $.level = "error" }');
    expect(
      alarms().find((alarm) => alarm.MetricName === "ErrorLines"),
    ).toMatchObject({
      Threshold: 1,
      ComparisonOperator: "GreaterThanOrEqualToThreshold",
    });
  });

  it("counts only heartbeats with the bridge connected, and treats silence as an alarm", () => {
    const filter = filters().find(
      (found) =>
        found.MetricTransformations[0].MetricName === "ConnectedHeartbeats",
    );
    expect(filter?.FilterPattern).toBe(
      '{ $.event = "heartbeat" && $.bridge = "connected" }',
    );
    expect(events).toContain("heartbeat");
    expect(
      alarms().find((alarm) => alarm.MetricName === "ConnectedHeartbeats"),
    ).toMatchObject({
      Period: 900,
      Threshold: 1,
      ComparisonOperator: "LessThanThreshold",
      TreatMissingData: "breaching",
    });
  });
});
