import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createAskevaMessaging } from "../src/askeva.js";

const token = "ss_" + "a".repeat(64);
const ticket = {
  mobile: "9876543210",
  name: "Sample Guest",
  reference: "SS2026-SAMPLE",
  eventDate: "2026-11-11",
  adults: 2,
  kids: 1,
  amount: 200,
  status: "PAID",
  type: "TICKET",
  ticketLink: `https://tickets.santassocial.com/ticket/sample#${token}`,
};
function fixture(
  response = { messages: [{ id: "wamid.synthetic" }] },
  ok = true,
) {
  const calls = [];
  return {
    calls,
    provider: createAskevaMessaging({
      apiKey: "synthetic-secret",
      fetchImpl: async (url, options) => {
        calls.push({ url, options, payload: JSON.parse(options.body) });
        return { ok, json: async () => response };
      },
    }),
  };
}

test("AskEVA OTP uses the documented body and copy-code button with country code", async () => {
  const { provider, calls } = fixture();
  await provider.sendOtp("9876543210", "102837");
  const { url, options, payload } = calls[0];
  assert.equal(url.origin, "https://backend.askeva.io");
  assert.equal(url.pathname, "/v1/message/send-message");
  assert.equal(url.searchParams.get("token"), "synthetic-secret");
  assert.equal(options.redirect, "error");
  assert.ok(options.signal);
  assert.equal(payload.to, "919876543210");
  assert.equal(payload.template.name, "santa_social_otp");
  assert.equal(payload.template.components[0].parameters[0].text, "102837");
  assert.deepEqual(payload.template.components[1], {
    type: "button",
    sub_type: "url",
    index: "0",
    parameters: [{ type: "text", text: "102837" }],
  });
});

test("paid and pending cash notifications use seven ordered variables and the original secure bearer link", async () => {
  const { provider, calls } = fixture();
  await provider.sendNotification(ticket);
  await provider.sendNotification({
    ...ticket,
    type: "CASH_PENDING",
    status: "PENDING_CASH",
    eventDate: "2026-11-12",
  });
  for (const { payload } of calls) {
    assert.equal(payload.template.name, "santa_social_ticket");
    assert.equal(payload.template.language.code, "en");
    assert.equal(payload.template.components.length, 1);
    const values = payload.template.components[0].parameters.map((v) => v.text);
    assert.equal(values.length, 7);
    assert.deepEqual(values.slice(0, 2), [ticket.name, ticket.reference]);
    assert.deepEqual(values.slice(3, 5), ["2", "1"]);
    assert.equal(values[6], ticket.ticketLink);
  }
  const values = calls.map((c) =>
    c.payload.template.components[0].parameters.map((v) => v.text),
  );
  assert.equal(values[0][2], "Wednesday, 11 November 2026");
  assert.equal(values[1][2], "Thursday, 12 November 2026");
  assert.match(values[0][5], /^Paid:/);
  assert.match(values[1][5], /Cash due:.*Approval required/);
  await assert.rejects(
    provider.sendNotification({
      ...ticket,
      status: "PAYMENT_REVIEW",
      type: "PAYMENT_REVIEW",
    }),
  );
  await assert.rejects(
    provider.sendNotification({
      ...ticket,
      ticketLink: "https://tickets.santassocial.com/ticket/sample",
    }),
  );
  assert.equal(calls.length, 2);
});

test("provider rejection, malformed response and timeout fail safely without exposing OTP, token or URL", async () => {
  for (const [response, ok] of [
    [{ error: "secret provider error" }, true],
    [{ code: 132000 }, true],
    [{}, true],
    [{ messages: [{ id: "wamid.synthetic" }] }, false],
  ]) {
    const { provider, calls } = fixture(response, ok);
    await assert.rejects(provider.sendOtp("9876543210", "102837"), (e) => {
      assert.equal(e.status, 503);
      assert.doesNotMatch(
        e.message,
        /synthetic-secret|102837|https:|provider error/,
      );
      return true;
    });
    assert.equal(calls.length, 1);
  }
  const provider = createAskevaMessaging({
    apiKey: "synthetic-secret",
    fetchImpl: async () => {
      throw Error("timeout https://secret?token=synthetic-secret OTP 102837");
    },
  });
  await assert.rejects(
    provider.sendOtp("9876543210", "102837"),
    /WhatsApp delivery failed/,
  );
});

test("live WhatsApp with demo APP_MODE and live Razorpay never exposes OTP and preserves expiry, attempts and ticket delivery", () => {
  const source = `
    import assert from 'node:assert/strict';
    import { mock } from 'node:test';
    import { DatabaseSync } from 'node:sqlite';
    import { readFileSync } from 'node:fs';
    import { randomUUID } from 'node:crypto';
    import request from 'supertest';
    import { createApp } from './src/app.js';
    import { createBooking, getBooking, now, settleCaptured, approveCash } from './src/services.js';
    import { startNotificationWorker } from './src/notification-worker.js';
    import { dispatchNotifications } from './src/providers.js';
    const clock=new Date('2026-11-11T06:00:00Z').getTime();
    mock.timers.enable({apis:['Date'],now:clock});
    const sql=new DatabaseSync(':memory:');
    sql.exec(readFileSync('migrations/001_initial.sql','utf8'));
    const tx={all:async(q,v=[])=>sql.prepare(q.replace(/ FOR UPDATE/g,'')).all(...v),
      run:async(q,v=[])=>({changes:Number(sql.prepare(q.replace(/ FOR UPDATE/g,'')).run(...v).changes)})};
    const db={...tx,transaction:async work=>{sql.exec('BEGIN');try{const r=await work(tx);sql.exec('COMMIT');return r;}catch(e){sql.exec('ROLLBACK');throw e;}}};
    await db.run('INSERT INTO events(id,name,capacity) VALUES(?,?,?)',['santa-2026','Santa Social',0]);
    const calls=[];let fail=false;
    globalThis.fetch=async(_url,options)=>{const body=JSON.parse(options.body);calls.push(body);
      return {ok:!fail,json:async()=>fail?{error:'secret'}:{messages:[{id:'wamid.synthetic'}]}};};
    const app=createApp(db);const agent=request.agent(app);
    const post=(path,body)=>agent.post('/api'+path).set('Origin',process.env.FRONTEND_ORIGIN).send(body);
    const health=await agent.get('/api/health').expect(200);
    assert.equal(health.body.mode,'demo');assert.equal(health.body.otpMode,'live');assert.equal(health.body.paymentMode,'live');
    const sent=await post('/otp/send',{mobile:'9876543210'}).expect(200);
    assert.equal(sent.body.demo,false);assert.equal(sent.body.demoCode,undefined);assert.equal(sent.body.expiresIn,300);
    const code=calls.at(-1).template.components[0].parameters[0].text;
    await post('/otp/send',{mobile:'9876543210'}).expect(429);
    assert.equal(calls.length,1);
    await post('/otp/verify',{mobile:'9876543210',challengeId:sent.body.challengeId,otp:code==='000000'?'111111':'000000'}).expect(400);
    await post('/otp/verify',{mobile:'9876543210',challengeId:sent.body.challengeId,otp:code}).expect(200);
    await post('/otp/verify',{mobile:'9876543210',challengeId:sent.body.challengeId,otp:code}).expect(400);
    const booking=await createBooking(db,{name:'Sample Guest',email:'sample@example.com',eventDate:'2026-11-11',adults:2,kids:1,method:'CASH'},'9876543210',randomUUID());
    await dispatchNotifications(db);
    assert.equal((await db.all('SELECT status FROM notification_logs WHERE bookingId=?',[booking.id]))[0].status,'SENT');
    const notification=calls.at(-1).template.components[0].parameters.map(p=>p.text);
    assert.equal(notification[0],'Sample Guest');assert.match(notification[5],/Cash due/);
    const link=new URL(notification[6]);assert.equal(link.pathname,'/ticket/'+booking.id);assert.match(link.hash,/^#ss_/);
    await request(app).get('/api/tickets/'+booking.id).expect(403);
    await request(app).get('/api/tickets/'+booking.id).set('Authorization','Bearer '+link.hash.slice(1)).expect(200);
    // Expired codes and attempt exhaustion cannot create verified sessions.
    for(const [mobile,exhaust] of [['9876543211',false],['9876543212',true]]){
      const isolated=request.agent(createApp(db));
      const localPost=(path,body)=>isolated.post('/api'+path).set('Origin',process.env.FRONTEND_ORIGIN).send(body);
      const r=await localPost('/otp/send',{mobile}).expect(200);const otp=calls.at(-1).template.components[0].parameters[0].text;
      if(exhaust){for(let i=0;i<5;i++)await localPost('/otp/verify',{mobile,challengeId:r.body.challengeId,otp:'000000'}).expect(400);}
      else mock.timers.tick(300001);
      await localPost('/otp/verify',{mobile,challengeId:r.body.challengeId,otp}).expect(400);
    }
    // Historical simulated online jobs must not produce paid WhatsApp messages.
    const old=await createBooking(db,{name:'Historical Sample',email:'sample@example.com',eventDate:'2026-11-11',adults:1,kids:0,method:'RAZORPAY'},'9876543210',randomUUID());
    await db.run('UPDATE payments SET orderId=?,paymentId=?,status=? WHERE bookingId=?',['order_demo_old','pay_demo_old','CAPTURED',old.id]);
    await db.run('UPDATE bookings SET status=? WHERE id=?',['PAID',old.id]);
    await db.run('INSERT INTO notification_logs(id,bookingId,type,status,nextAttemptAt) VALUES(?,?,?,?,?)',[randomUUID(),old.id,'TICKET','QUEUED',now()]);
    const before=calls.length;
    await dispatchNotifications(db);
    assert.equal(calls.length,before);
    assert.equal((await db.all('SELECT status FROM notification_logs WHERE bookingId=?',[old.id]))[0].status,'SUPERSEDED');
    fail=true;
    const failed=await post('/otp/send',{mobile:'9876543213'}).expect(503);
    assert.doesNotMatch(JSON.stringify(failed.body),/wamid|synthetic-secret/);
    assert.equal((await db.all('SELECT * FROM otp_verifications WHERE mobile=?',['9876543213'])).length,0);
    assert.equal((await getBooking(db,booking.id)).status,'PENDING_CASH');
    // The live worker delivers online capture and cash approval without a cron run.
    fail=false;
    const online=await createBooking(db,{name:'Online Guest',email:'sample@example.com',eventDate:'2026-11-11',adults:1,kids:0,method:'RAZORPAY'},'9876543210',randomUUID());
    await db.run('UPDATE payments SET orderId=? WHERE bookingId=?',['order_live_notification',online.id]);
    await settleCaptured(db,'order_live_notification','pay_live_notification',100,'INR');
    const adminId=randomUUID();
    await db.run('INSERT INTO users(id,name,email,passwordHash,role,createdAt) VALUES(?,?,?,?,?,?)',[adminId,'Admin','admin@example.com','synthetic','ADMIN',now()]);
    await approveCash(db,booking.id,booking.amount,adminId);
    const worker=startNotificationWorker(db);
    await worker.wake();
    const sentTickets=calls.filter(c=>c.template.name==='santa_social_ticket').map(c=>c.template.components[0].parameters.map(p=>p.text));
    for(const b of [online,booking]){
      const message=sentTickets.find(v=>v[1]===b.reference && v[5].startsWith('Paid:'));
      assert.ok(message,'paid receipt must be sent automatically');
      assert.equal(message[0],b.name);
      assert.equal(message[6].split('#')[0],process.env.FRONTEND_ORIGIN+'/ticket/'+b.id);
      const link=new URL(message[6]);
      await request(app).get('/api/tickets/'+b.id).set('Authorization','Bearer '+link.hash.slice(1)).expect(200);
    }
    const count=calls.length;
    await settleCaptured(db,'order_live_notification','pay_live_notification',100,'INR');
    await worker.wake();
    assert.equal(calls.length,count,'repeated settlement must not resend a sent receipt');
    await worker.close();
    sql.close();mock.timers.reset();
  `;
  const env = {
    ...process.env,
    NODE_ENV: "test",
    APP_MODE: "demo",
    PAYMENT_MODE: "live",
    WHATSAPP_MODE: "live",
    DB_DRIVER: "mysql",
    DATABASE_URL: "mysql://synthetic:password@localhost/santa_test",
    DB_HOST: "",
    DB_PORT: "",
    DB_USER: "",
    DB_PASSWORD: "",
    DB_NAME: "",
    SESSION_SECRET: "s".repeat(64),
    TICKET_SECRET: "t".repeat(64),
    OTP_SECRET: "o".repeat(64),
    RAZORPAY_KEY_ID: "rzp_live_synthetic123",
    RAZORPAY_KEY_SECRET: "synthetic-key-secret",
    RAZORPAY_WEBHOOK_SECRET: "w".repeat(64),
    FRONTEND_ORIGIN: "https://tickets.santassocial.com",
    ASKEVA_API_KEY: "synthetic-secret",
    ASKEVA_ADAPTER_MODULE: "",
  };
  const result = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", source],
    {
      cwd: new URL("..", import.meta.url),
      env,
      encoding: "utf8",
    },
  );
  assert.equal(result.status, 0, result.stdout + result.stderr);
  for (const overrides of [
    { WHATSAPP_MODE: "invalid" },
    { ASKEVA_API_KEY: "" },
    { DB_DRIVER: "sqlite" },
  ]) {
    const invalid = spawnSync(
      process.execPath,
      ["--input-type=module", "-e", "await import('./src/config.js')"],
      {
        cwd: new URL("..", import.meta.url),
        env: { ...env, ...overrides },
        encoding: "utf8",
      },
    );
    assert.notEqual(invalid.status, 0);
  }
});
