import assert from "node:assert/strict";
import test from "node:test";
import {
  organizationDatetimeDefault,
  organizationDatetimeExact,
  organizationDatetimeToIso,
  organizationDatetimeToastLabel,
} from "../../lib/organization-datetime";

const cordoba = "America/Argentina/Cordoba";

test("organization default keeps the Cordoba day while UTC and Auckland are tomorrow", () => {
  assert.equal(organizationDatetimeDefault(cordoba, new Date("2026-09-13T02:46:00Z")), "2026-09-12T23:50");
  assert.equal(organizationDatetimeToIso("2026-09-12T23:50", cordoba), "2026-09-13T02:50:00.000Z");
});

test("organization datetime is independent of the host local timezone", () => {
  const original = process.env.TZ;
  try {
    for (const timezone of ["Pacific/Auckland", "UTC", cordoba]) {
      process.env.TZ = timezone;
      assert.equal(organizationDatetimeExact("2026-09-13T02:46:42Z", cordoba), "2026-09-12T23:46");
      assert.equal(organizationDatetimeToIso("2026-09-13T09:00", cordoba), "2026-09-13T12:00:00.000Z");
      assert.equal(organizationDatetimeToastLabel("2026-09-12T23:50", cordoba, new Date("2026-09-13T02:46:00Z")), "23:50");
    }
  } finally {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  }
});

test("exact defaults distinguish instants with offsets from unchanged calendar wall clocks", () => {
  assert.equal(organizationDatetimeExact("2026-09-13T14:46:42+12:00", cordoba), "2026-09-12T23:46");
  assert.equal(organizationDatetimeExact("2026-09-12T23:46:42-03:00", cordoba), "2026-09-12T23:46");
  assert.equal(organizationDatetimeExact("2026-09-13T09:07", cordoba), "2026-09-13T09:07");
  assert.equal(organizationDatetimeExact("2026-09-13T09:07:42.123", cordoba), "2026-09-13T09:07");
});

test("organization defaults preserve the existing add-five then nearest-five rounding", () => {
  for (const [instant, expected] of [
    ["2026-06-14T13:07:00Z", "2026-06-14T10:10"],
    ["2026-06-14T13:08:00Z", "2026-06-14T10:15"],
    ["2026-06-14T13:53:59Z", "2026-06-14T11:00"],
    ["2026-06-15T02:54:00Z", "2026-06-15T00:00"],
    ["2027-01-01T02:54:00Z", "2027-01-01T00:00"],
  ]) assert.equal(organizationDatetimeDefault(cordoba, new Date(instant)), expected);
});

test("explicit organization offsets support non-Argentina and fractional-offset zones", () => {
  assert.equal(organizationDatetimeExact("2026-09-13T02:46:00Z", "Pacific/Auckland"), "2026-09-13T14:46");
  assert.equal(organizationDatetimeToIso("2026-09-13T09:00", "Pacific/Auckland"), "2026-09-12T21:00:00.000Z");
  assert.equal(organizationDatetimeToIso("2026-09-13T09:00", "Asia/Kathmandu"), "2026-09-13T03:15:00.000Z");
});

test("nonexistent DST wall clocks are rejected instead of silently moving the visit", () => {
  assert.throws(() => organizationDatetimeToIso("2026-03-08T02:30", "America/New_York"), RangeError);
  assert.throws(() => organizationDatetimeToIso("2026-10-04T02:15", "Australia/Lord_Howe"), RangeError);
  assert.throws(() => organizationDatetimeToIso("2011-12-30T12:00", "Pacific/Apia"), RangeError);
});

test("ambiguous DST wall clocks require a different time instead of silently choosing an instant", () => {
  assert.throws(() => organizationDatetimeToIso("2026-11-01T01:30", "America/New_York"), RangeError);
  assert.throws(() => organizationDatetimeToIso("2026-04-05T01:45", "Australia/Lord_Howe"), RangeError);
  assert.equal(organizationDatetimeExact("2026-11-01T05:30:00Z", "America/New_York"), "2026-11-01T01:30");
  assert.equal(organizationDatetimeExact("2026-11-01T06:30:00Z", "America/New_York"), "2026-11-01T01:30");
});

test("default rounding around a DST jump produces an existing organization time", () => {
  assert.equal(organizationDatetimeDefault("America/New_York", new Date("2026-03-08T06:58:00Z")), "2026-03-08T03:05");
});

test("invalid calendar dates and times are rejected before Date can normalize them", () => {
  for (const value of ["2026-02-29T09:00", "2026-02-30T09:00", "2026-13-01T09:00", "2026-09-00T09:00", "2026-09-13T24:00", "2026-09-13T09:60", "0000-01-01T09:00", "2026-09-13", "2026-09-13T09:00Z"]) {
    assert.throws(() => organizationDatetimeToIso(value, cordoba), RangeError);
  }
  assert.equal(organizationDatetimeToIso("2028-02-29T09:00", cordoba), "2028-02-29T12:00:00.000Z");
  for (const value of ["2026-02-30T09:00Z", "2026-09-13T09:00:60Z", "2026-09-13T09:00+25:00", "not a date"]) {
    assert.throws(() => organizationDatetimeExact(value, cordoba), RangeError);
  }
});

test("invalid organization zones and invalid current instants never fall back to the browser", () => {
  for (const timezone of ["Invalid/Timezone", ""]) {
    assert.throws(() => organizationDatetimeExact("2026-09-13T09:00", timezone), RangeError);
    assert.throws(() => organizationDatetimeDefault(timezone, new Date("2026-09-13T02:46Z")), RangeError);
    assert.throws(() => organizationDatetimeToIso("2026-09-13T09:00", timezone), RangeError);
    assert.throws(() => organizationDatetimeToastLabel("2026-09-13T09:00", timezone), RangeError);
  }
  assert.throws(() => organizationDatetimeDefault(cordoba, new Date(NaN)), RangeError);
  assert.throws(() => organizationDatetimeToastLabel("2026-09-13T09:00", cordoba, new Date(NaN)), RangeError);
});

test("toast today is the organization day and other dates retain their calendar label", () => {
  const now = new Date("2026-09-13T02:46:00Z");
  assert.equal(organizationDatetimeToastLabel("2026-09-12T23:50", cordoba, now), "23:50");
  assert.equal(organizationDatetimeToastLabel("2026-09-13T09:00", cordoba, now), "13/09 09:00");
  assert.throws(() => organizationDatetimeToastLabel("2026-02-30T09:00", cordoba, now), RangeError);
});
