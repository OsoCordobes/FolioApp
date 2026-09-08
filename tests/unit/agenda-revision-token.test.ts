import assert from "node:assert/strict";
import test from "node:test";
import { isAgendaRevisionToken } from "../../lib/agenda/revision-token";

test("revision tokens preserve the exact PostgreSQL counter and a real local calendar date",()=>{
  for(const value of ["0:2026-09-08","9223372036854775807:2028-02-29","1:2000-02-29","2:1900-03-01"])
    assert.equal(isAgendaRevisionToken(value),true,value);
  for(const value of [null,42,{},"42","42:","-1:2026-09-08","01:2026-09-08","9223372036854775808:2026-09-08",
    "1:2026-02-29","1:1900-02-29","1:2026-04-31","1:2026-13-01","1:2026-01-00","1:0000-01-01","1:2026-9-8","1:2026-09-08extra"])
    assert.equal(isAgendaRevisionToken(value),false,String(value));
});
