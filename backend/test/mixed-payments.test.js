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
    import { mock } from 'node:test';
    mock.timers.enable({apis:['Date'], now:new Date('2026-11-11T06:00:00Z').getTime()});
    import { DatabaseSync } from 'node:sqlite';
    import { readFileSync } from 'node:fs';
    import { randomUUID } from 'node:crypto';
    import request from 'supertest';
    import { createApp } from './src/app.js';
    import { hmac, qrToken, signSession } from './src/security.js';
    import { getBooking, inspectTicket, publicBooking, now, approveCash } from './src/services.js';
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
      assert.equal(input.currency,'INR'); assert.equal(input.amount,100);
      return {id:'order_'+randomUUID()};
    }, fetchPayments:async orderId=>({items:[...evidence.values()].filter(p=>p.order_id===orderId)})}, payments:{fetch:async id=>evidence.get(id)} };
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
        eventDate:'2026-11-11',adults:1,kids:0,method:'RAZORPAY'}).expect(201)).body;
    const b=await make();
    await post('/demo/payments/complete',{bookingId:b.id}).expect(404);
    const order=(await post('/payments/razorpay/order',{bookingId:b.id}).expect(200)).body;
    assert.equal(order.demo,false); assert.equal(order.keyId,process.env.RAZORPAY_KEY_ID);
    const id='pay_synthetic';
    const payload={bookingId:b.id,razorpay_order_id:order.orderId,razorpay_payment_id:id,
      razorpay_signature:hmac(order.orderId+'|'+id,process.env.RAZORPAY_KEY_SECRET)};
    evidence.set(id,{id,order_id:order.orderId,status:'authorized',amount:100,currency:'INR'});
    await post('/payments/razorpay/verify',payload).expect(202);
    assert.equal(publicBooking(await getBooking(db,b.id)).qrToken,null);
    evidence.set(id,{id,order_id:order.orderId,status:'captured',amount:1,currency:'INR'});
    await post('/payments/razorpay/verify',payload).expect(400);
    evidence.get(id).amount=100;
    await post('/payments/razorpay/verify',{...payload,razorpay_signature:'invalid'}).expect(400);
    const paid=(await post('/payments/razorpay/verify',payload).expect(200)).body;
    assert.equal(paid.status,'PAID'); assert.equal(paid.demo,false); assert.ok(paid.qrToken);
    // A signed provider webhook can settle payment when the browser is closed.
    const second=await make();
    const secondOrder=(await post('/payments/razorpay/order',{bookingId:second.id}).expect(200)).body;
    const event=JSON.stringify({event:'payment.captured',payload:{payment:{entity:{id:'pay_webhook',
      order_id:secondOrder.orderId,status:'captured',amount:100,currency:'INR'}}}});
    const webhook=signature=>request(app).post('/api/webhooks/razorpay').set('Content-Type','application/json')
      .set('x-razorpay-event-id','evt_synthetic').set('x-razorpay-signature',signature).send(event);
    await webhook('invalid').expect(400);
    await webhook(hmac(event,process.env.RAZORPAY_WEBHOOK_SECRET)).expect(200);
    await webhook(hmac(event,process.env.RAZORPAY_WEBHOOK_SECRET)).expect(200);
    assert.equal((await getBooking(db,second.id)).status,'PAID');
    assert.equal((await db.all('SELECT * FROM webhook_events')).length,1);
    // Historical simulated online tickets stay visibly simulated and cannot enter.
    const old=await make();
    await db.run("DELETE FROM ticket_batches WHERE bookingId=?",[old.id]);
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

    // Live admin reports must not count historical simulations, even while
    // customer OTP/notifications remain simulated. Cash stays visible.
    const adminId=randomUUID();
    await db.run('INSERT INTO users (id,name,email,passwordHash,role,createdAt) VALUES (?,?,?,?,?,?)',
      [adminId,'Reporting Admin','reporting@example.com','unused','ADMIN',now()]);
    const adminCookie='santa_staff_session='+await signSession({userId:adminId,role:'ADMIN'},true);
    const get=path=>request(app).get('/api/admin'+path).set('Cookie',adminCookie);
    const paymentOnly=await make();
    await db.run("UPDATE payments SET orderId=?,paymentId=?,status='CAPTURED' WHERE bookingId=?",
      ['order_provider_legacy','pay_demo_only',paymentOnly.id]);
    await db.run("UPDATE bookings SET status='PAID' WHERE id=?",[paymentOnly.id]);
    const cash=async(name)=>(await customer.post('/api/bookings').set('Origin',process.env.FRONTEND_ORIGIN)
      .set('Idempotency-Key',randomUUID()).send({name,email:'cash@example.com',eventDate:'2026-11-11',adults:1,kids:0,method:'CASH'}).expect(201)).body;
    const unpaidCash=await cash('Unpaid Cash');
    const paidCash=await cash('Paid Cash');
    await approveCash(db,paidCash.id,100,adminId);
    const noOrder=await make();
    // Check-in history includes one real and one historical simulated entry.
    for(const record of [b,old]) {
      // These rows represent historical group entries, not individual approvals.
      await db.run('DELETE FROM individual_tickets WHERE bookingId=?',[record.id]);
      await db.run('DELETE FROM ticket_batches WHERE bookingId=?',[record.id]);
      await db.run('INSERT INTO checkins (id,bookingId,staffId,eventDate,adults,kids,people,idempotencyKey,createdAt) VALUES (?,?,?,?,?,?,?,?,?)',
        [randomUUID(),record.id,adminId,record.eventDate,record.adults,record.kids,record.people,randomUUID(),now()]);
      await db.run('UPDATE bookings SET checkedInAt=? WHERE id=?',[now(),record.id]);
      await db.run('INSERT INTO notification_logs (id,bookingId,type,status,nextAttemptAt) VALUES (?,?,?,?,?)',
        [randomUUID(),record.id,'REPORTING_TEST','FAILED',now()]);
    }
    const counts=async()=>({bookings:(await db.all('SELECT COUNT(*) AS n FROM bookings'))[0].n,
      payments:(await db.all('SELECT COUNT(*) AS n FROM payments'))[0].n,
      checkins:(await db.all('SELECT COUNT(*) AS n FROM checkins'))[0].n});
    const before=await counts();
    const expected=[b.id,second.id,unpaidCash.id,paidCash.id,noOrder.id].sort();
    const summary=(await get('/dashboard').expect(200)).body;
    assert.equal(summary.demo,false); assert.equal(summary.bookings,5);
    assert.equal(summary.attendees,3); assert.equal(summary.revenue,300);
    assert.equal(summary.onlineRevenue,200); assert.equal(summary.cashRevenue,100);
    assert.equal(summary.pendingCash,1); assert.equal(summary.entered,1);
    assert.equal(summary.notificationFailures,1);
    assert.equal((await get('/dashboard?date=2026-11-12').expect(200)).body.bookings,0);
    const listed=(await get('/bookings').expect(200)).body;
    assert.equal(listed.total,5); assert.equal(listed.pages,1);
    assert.deepEqual(listed.rows.map(row=>row.id).sort(),expected);
    assert.deepEqual((await get('/bookings?status=PENDING_CASH').expect(200)).body.rows.map(row=>row.id),[unpaidCash.id]);
    assert.equal((await get('/bookings?q='+old.reference).expect(200)).body.total,0);
    const csv=(await get('/bookings?format=csv').expect(200)).text;
    assert.ok(csv.includes(b.reference)); assert.ok(csv.includes(unpaidCash.reference));
    for(const simulated of [old,stale,paymentOnly]) {
      assert.ok(!csv.includes(simulated.reference));
      await get('/bookings/'+simulated.id).expect(404);
    }
    const detail=(await get('/bookings/'+b.id).expect(200)).body;
    assert.equal(detail.payments[0].paymentId,id); assert.equal(detail.payments[0].status,'CAPTURED');
    assert.deepEqual((await get('/payments').expect(200)).body.map(row=>row.bookingId).sort(),expected);
    assert.deepEqual((await get('/checkins').expect(200)).body.map(row=>row.bookingId),[b.id]);
    await request(app).get('/api/admin/dashboard').expect(401);
    await customer.get('/api/admin/bookings').expect(403);
    assert.deepEqual(await counts(),before);
    assert.equal((await getBooking(db,old.id)).gatewayPaymentId,'pay_demo_legacy');
    // Mobile return must verify signatures and capture without a browser cookie.
    const mobileBooking=await make();
    const mobileOrder=(await post('/payments/razorpay/order',{bookingId:mobileBooking.id}).expect(200)).body;
    assert.equal(mobileOrder.callbackUrl,process.env.FRONTEND_ORIGIN+'/api/payments/razorpay/return?bookingId='+mobileBooking.id);
    const mobileId='pay_mobile_return';
    const mobilePayload={razorpay_order_id:mobileOrder.orderId,razorpay_payment_id:mobileId,
      razorpay_signature:hmac(mobileOrder.orderId+'|'+mobileId,process.env.RAZORPAY_KEY_SECRET)};
    const redirect=body=>request(app).post('/api/payments/razorpay/return?bookingId='+mobileBooking.id)
      .type('form').send(body).expect(303);
    evidence.set(mobileId,{id:mobileId,order_id:mobileOrder.orderId,status:'authorized',amount:100,currency:'INR'});
    const unsigned=await redirect({...mobilePayload,razorpay_signature:'invalid'});
    assert.ok(!unsigned.headers.location.includes('/ticket/'));
    const awaiting=await redirect(mobilePayload);
    assert.ok(awaiting.headers.location.endsWith('payment=pending'));
    assert.equal(publicBooking(await getBooking(db,mobileBooking.id)).qrToken,null);
    await request(app).post('/api/payments/razorpay/status').set('Origin',process.env.FRONTEND_ORIGIN)
      .send({bookingId:mobileBooking.id}).expect(401);
    assert.equal((await post('/payments/razorpay/status',{bookingId:mobileBooking.id}).expect(200)).body.status,'PENDING_PAYMENT');
    evidence.get(mobileId).status='captured';
    evidence.get(mobileId).amount_refunded=100;
    assert.equal((await post('/payments/razorpay/status',{bookingId:mobileBooking.id}).expect(200)).body.status,'PENDING_PAYMENT');
    evidence.get(mobileId).amount_refunded=0;
    const recovered=(await post('/payments/razorpay/status',{bookingId:mobileBooking.id}).expect(200)).body;
    assert.equal(recovered.status,'PAID'); assert.ok(recovered.qrToken);
    const returned=await redirect(mobilePayload);
    assert.equal(returned.headers.location,'/ticket/'+mobileBooking.id+'#'+recovered.qrToken);
    assert.equal(returned.headers['referrer-policy'],'no-referrer');
    await redirect(mobilePayload); // duplicate callbacks retain the same QR/payment
    assert.equal((await db.all('SELECT * FROM payments WHERE bookingId=?',[mobileBooking.id])).length,1);
    assert.equal((await getBooking(db,mobileBooking.id)).checkedInAt,null);
    const direct=await make();
    const directOrder=(await post('/payments/razorpay/order',{bookingId:direct.id}).expect(200)).body;
    const directId='pay_direct_mobile';
    const directPayload={razorpay_order_id:directOrder.orderId,razorpay_payment_id:directId,
      razorpay_signature:hmac(directOrder.orderId+'|'+directId,process.env.RAZORPAY_KEY_SECRET)};
    evidence.set(directId,{id:directId,order_id:mobileOrder.orderId,status:'captured',amount:100,currency:'INR'});
    const directReturn=()=>request(app).post('/api/payments/razorpay/return?bookingId='+direct.id).type('form').send(directPayload).expect(303);
    assert.ok(!(await directReturn()).headers.location.includes('/ticket/'));
    assert.equal((await getBooking(db,direct.id)).status,'PENDING_PAYMENT');
    evidence.get(directId).order_id=directOrder.orderId;
    assert.ok((await directReturn()).headers.location.startsWith('/ticket/'+direct.id+'#ss_'));
    assert.equal((await getBooking(db,direct.id)).status,'PAID');

    sql.close();
    console.log('Mixed-mode contract checks passed.');
  `);
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
