const axios = require('axios');
const { generateTestEmail } = require('./test-helpers');

/**
 * Pairing Lifecycle Test Suite
 *
 * Covers reject / soft-delete / restore flows that are not covered by the
 * existing request→accept→list pairings suites:
 *
 *   POST   /api/pairing/reject/:pairingId
 *   DELETE /api/pairing/:pairingId
 *   PATCH  /api/pairing/:pairingId/restore
 *
 * Run standalone: node tests/pairing-lifecycle-test.js
 * (Server must be running, e.g. TEST_MOCK_LLM=true npm start)
 */
class PairingLifecycleTestRunner {
  constructor(options = {}) {
    this.baseURL = options.baseURL || process.env.TEST_BASE_URL || 'http://127.0.0.1:9000';
    this.timeout = options.timeout || 15000;
    this.testResults = { passed: 0, failed: 0, total: 0 };
    this.testData = { users: [] };
  }

  log(message, type = 'info') {
    const prefix = {
      info: '📝', pass: '✅', fail: '❌', warn: '⚠️', section: '🧪', data: '💾'
    }[type] || '📝';
    console.log(`${prefix} [${new Date().toISOString()}] ${message}`);
  }

  assert(condition, testName, details = '') {
    this.testResults.total++;
    if (condition) {
      this.testResults.passed++;
      this.log(`${testName} - PASSED ${details}`, 'pass');
    } else {
      this.testResults.failed++;
      this.log(`${testName} - FAILED ${details}`, 'fail');
    }
  }

  authHeader(token) {
    return { headers: { Authorization: `Bearer ${token}` }, timeout: this.timeout };
  }

  async createUser(prefix = 'pairing-lifecycle') {
    const email = generateTestEmail(prefix);
    const res = await axios.post(`${this.baseURL}/api/users`, {
      email,
      password: 'SecurePass987!'
    }, { timeout: this.timeout });

    const user = {
      ...res.data.user,
      email,
      token: res.data.access_token
    };
    this.testData.users.push(user);
    return user;
  }

  async requestPairing(user) {
    const res = await axios.post(
      `${this.baseURL}/api/pairing/request`,
      {},
      this.authHeader(user.token)
    );
    return res.data;
  }

  async acceptPairing(user, partnerCode) {
    return axios.post(
      `${this.baseURL}/api/pairing/accept`,
      { partner_code: partnerCode },
      this.authHeader(user.token)
    );
  }

  // ─────────────────────────────────────────────
  // Reject
  // ─────────────────────────────────────────────
  async runRejectTests() {
    this.log('POST /api/pairing/reject/:pairingId', 'section');

    const requester = await this.createUser('pl-reject-req');
    const outsider = await this.createUser('pl-reject-out');

    // Happy path: requester cancels their pending invite
    const pending = await this.requestPairing(requester);
    this.assert(!!pending.pairing_id, 'Request returns pairing_id', `id=${pending.pairing_id}`);
    this.assert(!!pending.partner_code, 'Request returns partner_code');

    const rejectRes = await axios.post(
      `${this.baseURL}/api/pairing/reject/${pending.pairing_id}`,
      {},
      this.authHeader(requester.token)
    );
    this.assert(rejectRes.status === 200, 'Requester reject pending → 200', `status=${rejectRes.status}`);
    this.assert(
      typeof rejectRes.data?.message === 'string' && rejectRes.data.message.toLowerCase().includes('reject'),
      'Reject response includes success message',
      `msg=${rejectRes.data?.message}`
    );

    // Already processed
    try {
      await axios.post(
        `${this.baseURL}/api/pairing/reject/${pending.pairing_id}`,
        {},
        this.authHeader(requester.token)
      );
      this.assert(false, 'Reject already-processed pairing should fail', 'Request succeeded');
    } catch (error) {
      this.assert(
        error.response?.status === 400,
        'Reject already-processed → 400',
        `status=${error.response?.status}`
      );
    }

    // Outsider cannot reject someone else's pending invite
    const pending2 = await this.requestPairing(requester);
    try {
      await axios.post(
        `${this.baseURL}/api/pairing/reject/${pending2.pairing_id}`,
        {},
        this.authHeader(outsider.token)
      );
      this.assert(false, 'Outsider reject should fail', 'Request succeeded');
    } catch (error) {
      this.assert(
        error.response?.status === 403,
        'Outsider reject → 403',
        `status=${error.response?.status}`
      );
    }

    // Reject after accept is not allowed
    const userA = await this.createUser('pl-reject-a');
    const userB = await this.createUser('pl-reject-b');
    const acceptedReq = await this.requestPairing(userA);
    await this.acceptPairing(userB, acceptedReq.partner_code);
    try {
      await axios.post(
        `${this.baseURL}/api/pairing/reject/${acceptedReq.pairing_id}`,
        {},
        this.authHeader(userA.token)
      );
      this.assert(false, 'Reject accepted pairing should fail', 'Request succeeded');
    } catch (error) {
      this.assert(
        error.response?.status === 400,
        'Reject accepted pairing → 400',
        `status=${error.response?.status}`
      );
    }

    // Auth required
    try {
      await axios.post(
        `${this.baseURL}/api/pairing/reject/${pending2.pairing_id}`,
        {},
        { timeout: this.timeout }
      );
      this.assert(false, 'Reject without token should fail', 'Request succeeded');
    } catch (error) {
      this.assert(error.response?.status === 401, 'Reject without token → 401', `status=${error.response?.status}`);
    }

    // Unknown pairing
    try {
      await axios.post(
        `${this.baseURL}/api/pairing/reject/nonexistent-pairing-id`,
        {},
        this.authHeader(requester.token)
      );
      this.assert(false, 'Reject unknown pairing should fail', 'Request succeeded');
    } catch (error) {
      this.assert(
        error.response?.status === 404 || error.response?.status === 500,
        'Reject unknown pairing → 404/500',
        `status=${error.response?.status}`
      );
    }
  }

  // ─────────────────────────────────────────────
  // Soft-delete + restore
  // ─────────────────────────────────────────────
  async runSoftDeleteRestoreTests() {
    this.log('DELETE /api/pairing/:id + PATCH restore', 'section');

    const user1 = await this.createUser('pl-del-u1');
    const user2 = await this.createUser('pl-del-u2');
    const outsider = await this.createUser('pl-del-out');

    const req = await this.requestPairing(user1);
    await this.acceptPairing(user2, req.partner_code);
    const pairingId = req.pairing_id;

    // Soft-delete by a member
    const delRes = await axios.delete(
      `${this.baseURL}/api/pairing/${pairingId}`,
      this.authHeader(user1.token)
    );
    this.assert(delRes.status === 200, 'Member soft-delete → 200', `status=${delRes.status}`);
    this.assert(
      typeof delRes.data?.message === 'string' && delRes.data.message.toLowerCase().includes('deleted'),
      'Soft-delete response includes success message',
      `msg=${delRes.data?.message}`
    );

    // Pairing no longer listed for either member
    const list1 = await axios.get(`${this.baseURL}/api/pairings`, this.authHeader(user1.token));
    const stillThere1 = (list1.data.pairings || []).some(p => p.id === pairingId);
    this.assert(!stillThere1, 'Soft-deleted pairing absent from user1 list');

    const list2 = await axios.get(`${this.baseURL}/api/pairings`, this.authHeader(user2.token));
    const stillThere2 = (list2.data.pairings || []).some(p => p.id === pairingId);
    this.assert(!stillThere2, 'Soft-deleted pairing absent from user2 list');

    // GET by id → 404 while deleted
    try {
      await axios.get(`${this.baseURL}/api/pairing/${pairingId}`, this.authHeader(user1.token));
      this.assert(false, 'GET soft-deleted pairing should fail', 'Request succeeded');
    } catch (error) {
      this.assert(
        error.response?.status === 404 || error.response?.status === 500,
        'GET soft-deleted pairing → 404/500',
        `status=${error.response?.status}`
      );
    }

    // Double-delete → not found
    try {
      await axios.delete(
        `${this.baseURL}/api/pairing/${pairingId}`,
        this.authHeader(user1.token)
      );
      this.assert(false, 'Double soft-delete should fail', 'Request succeeded');
    } catch (error) {
      this.assert(
        error.response?.status === 404,
        'Double soft-delete → 404',
        `status=${error.response?.status}`
      );
    }

    // Restore
    const restoreRes = await axios.patch(
      `${this.baseURL}/api/pairing/${pairingId}/restore`,
      {},
      this.authHeader(user1.token)
    );
    this.assert(restoreRes.status === 200, 'Restore soft-deleted pairing → 200', `status=${restoreRes.status}`);
    this.assert(
      typeof restoreRes.data?.message === 'string' && restoreRes.data.message.toLowerCase().includes('restored'),
      'Restore response includes success message',
      `msg=${restoreRes.data?.message}`
    );

    // Visible again after restore
    const listAfter = await axios.get(`${this.baseURL}/api/pairings`, this.authHeader(user1.token));
    const restored = (listAfter.data.pairings || []).some(p => p.id === pairingId);
    this.assert(restored, 'Restored pairing present in user1 list');

    // Restore when not deleted
    try {
      await axios.patch(
        `${this.baseURL}/api/pairing/${pairingId}/restore`,
        {},
        this.authHeader(user1.token)
      );
      this.assert(false, 'Restore non-deleted pairing should fail', 'Request succeeded');
    } catch (error) {
      this.assert(
        error.response?.status === 404,
        'Restore non-deleted pairing → 404',
        `status=${error.response?.status}`
      );
    }

    // Outsider cannot soft-delete a live pairing
    try {
      await axios.delete(
        `${this.baseURL}/api/pairing/${pairingId}`,
        this.authHeader(outsider.token)
      );
      this.assert(false, 'Outsider soft-delete should fail', 'Request succeeded');
    } catch (error) {
      this.assert(
        error.response?.status === 403,
        'Outsider soft-delete → 403',
        `status=${error.response?.status}`
      );
    }

    // Soft-delete again so outsider-restore can be checked against a deleted row
    await axios.delete(
      `${this.baseURL}/api/pairing/${pairingId}`,
      this.authHeader(user1.token)
    );

    // Outsider cannot restore a soft-deleted pairing (IDOR guard)
    try {
      await axios.patch(
        `${this.baseURL}/api/pairing/${pairingId}/restore`,
        {},
        this.authHeader(outsider.token)
      );
      this.assert(false, 'Outsider restore should fail', 'Request succeeded');
    } catch (error) {
      this.assert(
        error.response?.status === 403,
        'Outsider restore → 403',
        `status=${error.response?.status}`
      );
    }

    // Member can restore after outsider was denied
    const memberRestore = await axios.patch(
      `${this.baseURL}/api/pairing/${pairingId}/restore`,
      {},
      this.authHeader(user1.token)
    );
    this.assert(memberRestore.status === 200, 'Member restore after outsider denial → 200', `status=${memberRestore.status}`);

    // Auth required for delete + restore
    try {
      await axios.delete(`${this.baseURL}/api/pairing/${pairingId}`, { timeout: this.timeout });
      this.assert(false, 'Soft-delete without token should fail', 'Request succeeded');
    } catch (error) {
      this.assert(error.response?.status === 401, 'Soft-delete without token → 401', `status=${error.response?.status}`);
    }

    try {
      await axios.patch(
        `${this.baseURL}/api/pairing/${pairingId}/restore`,
        {},
        { timeout: this.timeout }
      );
      this.assert(false, 'Restore without token should fail', 'Request succeeded');
    } catch (error) {
      this.assert(error.response?.status === 401, 'Restore without token → 401', `status=${error.response?.status}`);
    }

    // Non-admin cannot enumerate soft-deleted pairings
    try {
      await axios.get(`${this.baseURL}/api/pairing/deleted/all`, this.authHeader(user1.token));
      this.assert(false, 'Non-admin pairing deleted/all should fail', 'Request succeeded');
    } catch (error) {
      this.assert(
        error.response?.status === 403,
        'Non-admin GET /api/pairing/deleted/all → 403',
        `status=${error.response?.status}`
      );
    }
  }

  // ─────────────────────────────────────────────
  // max_pairings cannot be bypassed via leftover pending codes
  // ─────────────────────────────────────────────
  async runMaxPairingsGuardTests() {
    this.log('max_pairings leftover-pending + restore guards', 'section');

    // Signup auto-creates a pending partner code for every user.
    const alice = await this.createUser('pl-max-alice');
    const bob = await this.createUser('pl-max-bob');
    const carol = await this.createUser('pl-max-carol');

    const aliceSignupCode = (await axios.get(
      `${this.baseURL}/api/pairings`,
      this.authHeader(alice.token)
    )).data.pairings.find(p => p.status === 'pending')?.partner_code;

    const bobSignupCode = (await axios.get(
      `${this.baseURL}/api/pairings`,
      this.authHeader(bob.token)
    )).data.pairings.find(p => p.status === 'pending')?.partner_code;

    this.assert(!!aliceSignupCode, 'Alice has signup pending partner code');
    this.assert(!!bobSignupCode, 'Bob has signup pending partner code');

    // Alice accepts Bob → Alice-Bob paired; Alice's leftover signup code must be invalidated.
    await this.acceptPairing(alice, bobSignupCode);

    try {
      await this.acceptPairing(carol, aliceSignupCode);
      this.assert(false, 'Carol must not redeem Alice leftover pending after Alice is paired', 'Request succeeded');
    } catch (error) {
      this.assert(
        error.response?.status === 404 || error.response?.status === 400,
        'Leftover pending accept blocked → 404/400',
        `status=${error.response?.status}`
      );
    }

    const aliceAccepted = await axios.get(
      `${this.baseURL}/api/pairing/accepted`,
      this.authHeader(alice.token)
    );
    this.assert(
      (aliceAccepted.data.pairings || []).length === 1,
      'Alice has exactly one accepted pairing',
      `count=${(aliceAccepted.data.pairings || []).length}`
    );

    // Restore must not exceed max_pairings after rematch:
    // soft-delete Alice-Bob, Alice pairs with Carol, restore Alice-Bob → 400.
    const aliceBobId = aliceAccepted.data.pairings[0].id;
    await axios.delete(
      `${this.baseURL}/api/pairing/${aliceBobId}`,
      this.authHeader(alice.token)
    );

    const carolCode = (await axios.get(
      `${this.baseURL}/api/pairings`,
      this.authHeader(carol.token)
    )).data.pairings.find(p => p.status === 'pending')?.partner_code;
    this.assert(!!carolCode, 'Carol still has a pending partner code');
    await this.acceptPairing(alice, carolCode);

    try {
      await axios.patch(
        `${this.baseURL}/api/pairing/${aliceBobId}/restore`,
        {},
        this.authHeader(alice.token)
      );
      this.assert(false, 'Restore over max_pairings should fail', 'Request succeeded');
    } catch (error) {
      this.assert(
        error.response?.status === 400,
        'Restore over max_pairings → 400',
        `status=${error.response?.status}`
      );
    }
  }

  // Concurrent accepts of two different partner codes by the same user must not
  // exceed max_pairings=1 (TOCTOU race on count-then-accept).
  async runConcurrentAcceptCapTests() {
    this.log('Concurrent accept max_pairings race guard', 'section');

    const acceptor = await this.createUser('pl-race-acceptor');
    const requesterA = await this.createUser('pl-race-req-a');
    const requesterB = await this.createUser('pl-race-req-b');

    const codeA = (await axios.get(
      `${this.baseURL}/api/pairings`,
      this.authHeader(requesterA.token)
    )).data.pairings.find(p => p.status === 'pending')?.partner_code;
    const codeB = (await axios.get(
      `${this.baseURL}/api/pairings`,
      this.authHeader(requesterB.token)
    )).data.pairings.find(p => p.status === 'pending')?.partner_code;

    this.assert(!!codeA && !!codeB, 'Two distinct pending partner codes available for race');

    const results = await Promise.allSettled([
      this.acceptPairing(acceptor, codeA),
      this.acceptPairing(acceptor, codeB)
    ]);

    const fulfilled = results.filter(r => r.status === 'fulfilled');
    const rejected = results.filter(r => r.status === 'rejected');
    this.assert(
      fulfilled.length === 1,
      'Exactly one concurrent accept succeeds',
      `fulfilled=${fulfilled.length}`
    );
    this.assert(
      rejected.length === 1,
      'Exactly one concurrent accept fails',
      `rejected=${rejected.length}`
    );

    if (rejected[0]) {
      const status = rejected[0].reason?.response?.status;
      this.assert(
        status === 400 || status === 404 || status === 409,
        'Failed concurrent accept → 400/404/409',
        `status=${status}`
      );
    }

    const accepted = await axios.get(
      `${this.baseURL}/api/pairing/accepted`,
      this.authHeader(acceptor.token)
    );
    this.assert(
      (accepted.data.pairings || []).length === 1,
      'Acceptor has exactly one accepted pairing after race',
      `count=${(accepted.data.pairings || []).length}`
    );
  }

  // Soft-deleting a pairing must revoke the partner's access to shared programs.
  // Owners keep access via programs.user_id; partners only via an active pairing.
  async runSoftDeleteRevokesProgramAccessTests() {
    this.log('Soft-delete pairing revokes partner program access', 'section');

    const owner = await this.createUser('pl-prog-owner');
    const partner = await this.createUser('pl-prog-partner');

    // Program generation requires user_name on the creator profile.
    await axios.put(
      `${this.baseURL}/api/users/${owner.id}`,
      { user_name: 'Owner', partner_name: 'Partner' },
      this.authHeader(owner.token)
    );
    await axios.put(
      `${this.baseURL}/api/users/${partner.id}`,
      { user_name: 'Partner', partner_name: 'Owner' },
      this.authHeader(partner.token)
    );

    const req = await this.requestPairing(owner);
    await this.acceptPairing(partner, req.partner_code);
    const pairingId = req.pairing_id;

    const createRes = await axios.post(
      `${this.baseURL}/api/programs`,
      {
        user_input: 'Soft-delete access regression: improve communication after conflict.',
        pairing_id: pairingId
      },
      this.authHeader(owner.token)
    );
    this.assert(createRes.status === 201, 'Create paired program → 201', `status=${createRes.status}`);
    const programId = createRes.data?.program?.id;
    this.assert(!!programId, 'Create paired program returns id', `id=${programId}`);

    // Partner can read while pairing is active
    const partnerGetOk = await axios.get(
      `${this.baseURL}/api/programs/${programId}`,
      this.authHeader(partner.token)
    );
    this.assert(partnerGetOk.status === 200, 'Partner GET program while paired → 200', `status=${partnerGetOk.status}`);

    const partnerListOk = await axios.get(
      `${this.baseURL}/api/programs`,
      this.authHeader(partner.token)
    );
    const listedBefore = (partnerListOk.data.programs || []).some(p => p.id === programId);
    this.assert(listedBefore, 'Partner list includes paired program while pairing active');

    // Soft-delete the pairing
    const delRes = await axios.delete(
      `${this.baseURL}/api/pairing/${pairingId}`,
      this.authHeader(owner.token)
    );
    this.assert(delRes.status === 200, 'Soft-delete pairing for program access test → 200', `status=${delRes.status}`);

    // Partner must lose GET-by-id access
    try {
      await axios.get(
        `${this.baseURL}/api/programs/${programId}`,
        this.authHeader(partner.token)
      );
      this.assert(false, 'Partner GET program after pairing soft-delete should fail', 'Request succeeded');
    } catch (error) {
      this.assert(
        error.response?.status === 403,
        'Partner GET program after pairing soft-delete → 403',
        `status=${error.response?.status}`
      );
    }

    // Partner must no longer see it in list
    const partnerListAfter = await axios.get(
      `${this.baseURL}/api/programs`,
      this.authHeader(partner.token)
    );
    const listedAfter = (partnerListAfter.data.programs || []).some(p => p.id === programId);
    this.assert(!listedAfter, 'Partner list excludes program after pairing soft-delete');

    // Owner still has access via ownership
    const ownerGet = await axios.get(
      `${this.baseURL}/api/programs/${programId}`,
      this.authHeader(owner.token)
    );
    this.assert(ownerGet.status === 200, 'Owner GET program after pairing soft-delete → 200', `status=${ownerGet.status}`);
  }

  async runAllTests() {
    this.log('Starting Pairing Lifecycle Test Suite', 'section');

    try {
      await this.runRejectTests();
      await this.runSoftDeleteRestoreTests();
      await this.runSoftDeleteRevokesProgramAccessTests();
      await this.runMaxPairingsGuardTests();
      await this.runConcurrentAcceptCapTests();
    } catch (error) {
      this.log(`Unexpected suite error: ${error.message}`, 'fail');
      this.testResults.failed++;
      this.testResults.total++;
    }

    const { passed, failed, total } = this.testResults;
    console.log('\n============================================================');
    this.log('Pairing Lifecycle TEST SUMMARY');
    this.log(`Total:  ${total}`);
    this.log(`Passed: ${passed}`);
    this.log(`Failed: ${failed}`);
    console.log('============================================================');

    if (failed === 0) {
      this.log('All pairing lifecycle tests passed!', 'pass');
    } else {
      this.log(`${failed} test(s) failed.`, 'fail');
    }

    return failed === 0;
  }
}

if (require.main === module) {
  const runner = new PairingLifecycleTestRunner();
  runner.runAllTests()
    .then(success => process.exit(success ? 0 : 1))
    .catch(err => {
      console.error('Test runner failed:', err);
      process.exit(1);
    });
}

module.exports = PairingLifecycleTestRunner;
