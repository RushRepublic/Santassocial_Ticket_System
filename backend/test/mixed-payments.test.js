import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const env = {
  ...process.env,
  NODE_ENV: "test",
  APP_MODE: "demo",
  PAYMENT_MODE: "live",
  DB_DRIVER: "mysql",
  DATABASE_URL: "mysql://synthetic:password@localhost/santa_test",
  DB_HOST: "",
  DB_PORT: "",
  DB_USER: "",
  DB_PASSWORD: "",
  DB_NAME: "",
  FRONTEND_ORIGIN: "http://127.0.0.1:3000",
  SESSION_SECRET: "s".repeat(64),
  TICKET_SECRET: "t".repeat(64),
  OTP_SECRET: "o".repeat(64),
  RAZORPAY_KEY_ID: "rzp_live_synthetic123",
  RAZORPAY_KEY_SECRET: "synthetic-key-secret",
  RAZORPAY_WEBHOOK_SECRET: "w".repeat(64),
};
function run(source, overrides = {}) {
  return spawnSync(process.execPath, ["--input-type=module", "-e", source], {
    cwd: new URL("..", import.meta.url),
    env: { ...env, ...overrides },
    encoding: "utf8",
  });
}
test("live payment mode requires complete credentials and MySQL independently of OTP", () => {
  const source =
    "const c = await import('./src/config.js'); console.log(JSON.stringify({otp:c.demo,payments:c.paymentMode}))";
  const valid = run(source);
  assert.equal(valid.status, 0, valid.stderr);
  assert.deepEqual(JSON.parse(valid.stdout.trim()), {
    otp: true,
    payments: "live",
  });
  for (const overrides of [
    { PAYMENT_MODE: "invalid" },
    { DB_DRIVER: "sqlite" },
    { RAZORPAY_KEY_ID: "rzp_test_synthetic" },
    { RAZORPAY_KEY_SECRET: "" },
    { RAZORPAY_WEBHOOK_SECRET: "" },
    { RAZORPAY_WEBHOOK_SECRET: env.RAZORPAY_KEY_SECRET },
  ])
    assert.notEqual(run(source, overrides).status, 0);
});

test("real-provider payment flow retains simulated OTP, disables fake settlement and verifies capture/webhooks", () => {
  const result = run(`
    import assert from 'node:assert/strict';
    import { DatabaseSync } from 'node:sqlite';
    import { readFileSync } from 'node:fs';
    import { randomUUID } from 'node:crypto';
    import request from 'supertest';
    import { createApp } from './src/app.js';
    import { hmac, qrToken } from './src/security.js';
    import { getBooking, inspectTicket, publicBooking, now } from './src/services.js';
    // Local contract test only: SQLite with a mocked gateway, never a real charge.
    const sql = new DatabaseSync(':memory:');
    sql.exec(readFileSync('migrations/001_initial.sql','utf8'));
    const tx = {
      all: async (query, values=[]) => sql.prepare(query.replace(/ FOR UPDATE/g,'')).all(...values),
      run: async (query, values=[]) => ({changes:Number(sql.prepare(query.replace(/ FOR UPDATE/g,'')).run(...values).changes)}),
    };
    const db = { ...tx, transaction: async work => {
      sql.exec('BEGIN'); try { const value=await work(tx); sql.exec('COMMIT'); return value; }
      catch(error) {sql.exec('ROLLBACK'); throw error;}
    }};
    await db.run('INSERT INTO events (id,name,capacity) VALUES (?,?,?)', ['santa-2026','Santa Social',0]);
    const evidence = new Map();
    const gateway = { orders: { create: async input => {
      assert.equal(input.currency,'INR'); assert.equal(input.amount,20000);
      return {id:'order_'+randomUUID()};
    }}, payments:{fetch:async id=>evidence.get(id)} };
    const app=createApp(db,{paymentGateway:()=>gateway});
    const customer=request.agent(app);
    const post=(path,body)=>customer.post('/api'+path).set('Origin',process.env.FRONTEND_ORIGIN).send(body);
    const health=await customer.get('/api/health').expect(200);
    assert.equal(health.body.otpMode,'demo'); assert.equal(health.body.paymentMode,'live');
    const sent=await post('/otp/send',{mobile:'9876543210'}).expect(200);
    assert.match(sent.body.demoCode,/^\\d{6}$/);
    await post('/otp/verify',{mobile:'9876543210',challengeId:sent.body.challengeId,otp:sent.body.demoCode}).expect(200);
    const make=async()=> (await customer.post('/api/bookings').set('Origin',process.env.FRONTEND_ORIGIN)
      .set('Idempotency-Key',randomUUID()).send({name:'Gateway QA Guest',email:'qa@example.com',
        eventDate:'2026-12-05',adults:1,kids:0,method:'RAZORPAY'}).expect(201)).body;
    const b=await make();
    await post('/demo/payments/complete',{bookingId:b.id}).expect(404);
    const order=(await post('/payments/razorpay/order',{bookingId:b.id}).expect(200)).body;
    assert.equal(order.demo,false); assert.equal(order.keyId,process.env.RAZORPAY_KEY_ID);
    const id='pay_synthetic';
    const payload={bookingId:b.id,razorpay_order_id:order.orderId,razorpay_payment_id:id,
      razorpay_signature:hmac(order.orderId+'|'+id,process.env.RAZORPAY_KEY_SECRET)};
    evidence.set(id,{id,order_id:order.orderId,status:'authorized',amount:20000,currency:'INR'});
    await post('/payments/razorpay/verify',payload).expect(202);
    assert.equal(publicBooking(await getBooking(db,b.id)).qrToken,null);
    evidence.set(id,{id,order_id:order.orderId,status:'captured',amount:1,currency:'INR'});
    await post('/payments/razorpay/verify',payload).expect(400);
    evidence.get(id).amount=20000;
    await post('/payments/razorpay/verify',{...payload,razorpay_signature:'invalid'}).expect(400);
    const paid=(await post('/payments/razorpay/verify',payload).expect(200)).body;
    assert.equal(paid.status,'PAID'); assert.equal(paid.demo,false); assert.ok(paid.qrToken);
    // A signed provider webhook can settle payment when the browser is closed.
    const second=await make();
    const secondOrder=(await post('/payments/razorpay/order',{bookingId:second.id}).expect(200)).body;
    const event=JSON.stringify({event:'payment.captured',payload:{payment:{entity:{id:'pay_webhook',
      order_id:secondOrder.orderId,status:'captured',amount:20000,currency:'INR'}}}});
    const webhook=signature=>request(app).post('/api/webhooks/razorpay').set('Content-Type','application/json')
      .set('x-razorpay-event-id','evt_synthetic').set('x-razorpay-signature',signature).send(event);
    await webhook('invalid').expect(400);
    await webhook(hmac(event,process.env.RAZORPAY_WEBHOOK_SECRET)).expect(200);
    await webhook(hmac(event,process.env.RAZORPAY_WEBHOOK_SECRET)).expect(200);
    assert.equal((await getBooking(db,second.id)).status,'PAID');
    assert.equal((await db.all('SELECT * FROM webhook_events')).length,1);
    // Historical simulated online tickets stay visibly simulated and cannot enter.
    const old=await make();
    await db.run("UPDATE payments SET orderId=?,paymentId=?,status='CAPTURED' WHERE bookingId=?",
      ['order_demo_legacy','pay_demo_legacy',old.id]);
    await db.run("UPDATE bookings SET status='PAID',qrHash=? WHERE id=?", [
      (await import('./src/security.js')).hash(qrToken(await getBooking(db,old.id))),old.id]);
    const legacy=await getBooking(db,old.id);
    assert.equal(publicBooking(legacy).demo,true);
    await assert.rejects(inspectTicket(db,qrToken(legacy)),/TEST PAYMENT/);
    const stale=await make();
    await db.run('UPDATE payments SET orderId=? WHERE bookingId=?',['order_demo_pending',stale.id]);
    await post('/payments/razorpay/order',{bookingId:stale.id}).expect(409);
    sql.close();
    console.log('Mixed-mode contract checks passed.');
  `);
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
