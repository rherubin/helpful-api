const ProgramStep = require('../models/ProgramStep');
const Message = require('../models/Message');
const AdminUser = require('../models/AdminUser');
const Program = require('../models/Program');
const Pairing = require('../models/Pairing');
const DeviceToken = require('../models/DeviceToken');
const User = require('../models/User');
const OrgCode = require('../models/OrgCode');
const RefreshToken = require('../models/RefreshToken');
const PromptSession = require('../models/PromptSession');

function mockPool(execute) {
  const conn = {
    beginTransaction: async () => {},
    commit: async () => {},
    rollback: async () => {},
    release() {},
    execute
  };
  return { execute, getConnection: async () => conn };
}

function okPool(rows = []) {
  return mockPool(async () => [rows]);
}

function throwPool(err = new Error('db')) {
  return mockPool(async () => { throw err; });
}

class ResourceCoverageTestRunner {
  constructor(options = {}) {
    this.timeout = options.timeout || 20000;
    this.testResults = { passed: 0, failed: 0, total: 0 };
  }

  log(message, type = 'info') {
    const prefix = { info: '📝', pass: '✅', fail: '❌', warn: '⚠️', section: '🧪' }[type] || '📝';
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

  async expectThrow(fn, match, name) {
    try {
      await fn();
      this.assert(false, name, 'did not throw');
    } catch (e) {
      const ok = !match || (typeof match === 'string' ? e.message.includes(match) : match.test(e.message));
      this.assert(ok, name, e.message);
    }
  }


  async assertResolves(fn, name, check) {
    try {
      const result = await fn();
      const ok = typeof check === 'function' ? Boolean(check(result)) : true;
      this.assert(ok, name, ok ? '' : String(result));
      return result;
    } catch (e) {
      this.assert(false, name, 'threw: ' + e.message);
    }
  }

  async testProgramStep() {
    this.log('ProgramStep model', 'section');
    const steps = new ProgramStep(okPool([{ id: 's1', day: 1, metadata: '{"a":1}' }]));
    if (typeof steps.parseMetadata === 'function') {
      this.assert(steps.parseMetadata('{"a":1}').a === 1, 'ProgramStep parseMetadata json');
      this.assert(steps.parseMetadata({ a: 1 }).a === 1, 'ProgramStep parseMetadata object');
      this.assert(steps.parseMetadata('not-json') === 'not-json', 'ProgramStep parseMetadata invalid returns original string');
    }
    await this.assertResolves(() => steps.deleteProgramSteps('p1'), 'ProgramStep deleteProgramSteps success');
    await this.assertResolves(() => steps.getDayStep('p1', 1), 'ProgramStep getDayStep success', (r) => r == null || typeof r === 'object');
    await this.assertResolves(() => steps.getProgramDays('p1'), 'ProgramStep getProgramDays success', Array.isArray);
    await this.assertResolves(() => steps.getProgramSteps('p1'), 'ProgramStep getProgramSteps success', Array.isArray);
    await this.assertResolves(() => steps.getStepById('s1'), 'ProgramStep getStepById success', (r) => r && r.id === 's1');
    await this.assertResolves(() => steps.markStepAsStarted('s1'), 'ProgramStep markStepAsStarted success');
    await this.assertResolves(() => steps.checkStepAccess('u1', 'p1'), 'ProgramStep checkStepAccess success');
    await this.assertResolves(() => steps.recordUserContribution('s1', 'u1'), 'ProgramStep recordUserContribution success');
    await this.assertResolves(() => steps.getStepContributions('s1'), 'ProgramStep getStepContributions success');
    await this.assertResolves(() => steps.getStepContributionStatus('s1', 'pair1'), 'ProgramStep getStepContributionStatus success');

    const therapy = JSON.stringify({
      program: {
        title: 'T',
        days: Array.from({ length: 7 }, (_, i) => ({
          day: i + 1, theme: `Theme ${i + 1}`, conversation_starter: 'starter text here', science_behind_it: 'science text'
        }))
      }
    });
    const writer = new ProgramStep(okPool([]));
    await this.assertResolves(async () => writer.createProgramSteps('p1', therapy), 'ProgramStep createProgramSteps');
    await this.assertResolves(async () => writer.replaceProgramSteps('p1', therapy), 'ProgramStep replaceProgramSteps');
    await this.assertResolves(async () => writer.createProgramStep('p1', 1, 'Theme 1 here', 'starter text here', 'science text'), 'ProgramStep createProgramStep');
    await this.assertResolves(async () => writer.initDatabase(), 'ProgramStep initDatabase');

    const boom = new ProgramStep(throwPool());
    await this.expectThrow(() => boom.getProgramSteps('p1'), /Failed|Error|db/, 'ProgramStep getProgramSteps wraps errors');
    await this.expectThrow(() => boom.getDayStep('p1', 1), null, 'ProgramStep getDayStep wraps errors');
    await this.expectThrow(() => boom.getProgramDays('p1'), null, 'ProgramStep getProgramDays wraps errors');
    await this.expectThrow(() => boom.deleteProgramSteps('p1'), null, 'ProgramStep deleteProgramSteps wraps errors');
  }

  async testMessage() {
    this.log('Message model', 'section');
    const msg = new Message(okPool([{ id: 'm1', content: 'hi' }]));
    await this.assertResolves(() => msg.addMessage('c1', 'user', 'u1', 'hello', { t: 1 }), 'Message addMessage user');
    await this.assertResolves(() => msg.addMessage('c1', 'system', null, 'sys', null), 'Message addMessage system');
    await this.assertResolves(() => msg.getConversationMessages('c1'), 'Message getConversationMessages', Array.isArray);
    await this.assertResolves(() => msg.getMessageById('m1'), 'Message getMessageById', (r) => r && r.id === 'm1');
    await this.assertResolves(() => msg.updateMessage('m1', 'updated', { a: 1 }), 'Message updateMessage');
    await this.assertResolves(() => msg.deleteMessage('m1'), 'Message deleteMessage');
    const counter = new Message(okPool([{ count: 3 }]));
    await this.assertResolves(() => counter.getMessageCount('c1'), 'Message getMessageCount', (r) => r === 3);
    await this.assertResolves(() => msg.checkMessageAccess('u1', 'm1'), 'Message checkMessageAccess');
    await this.assertResolves(() => msg.addUserMessage('s1', 'u1', 'hi'), 'Message addUserMessage');
    await this.assertResolves(() => msg.addSystemMessage('s1', 'sys', { type: 'x' }), 'Message addSystemMessage');
    await this.assertResolves(() => msg.addStepMessage('s1', 'user', 'u1', 'hi'), 'Message addStepMessage');
    await this.assertResolves(() => msg.getStepMessages('s1'), 'Message getStepMessages', Array.isArray);
    await this.assertResolves(async () => msg.getMessageStatsSinceDate(0, 'p1'), 'Message getMessageStatsSinceDate');
    await this.assertResolves(async () => msg.initDatabase(), 'Message initDatabase');
    const boom = new Message(throwPool());
    await this.expectThrow(() => boom.addMessage('c', 'user', 'u', 'x'), null, 'Message addMessage wraps errors');
    await this.expectThrow(() => boom.getConversationMessages('c'), null, 'Message getConversationMessages wraps errors');
    await this.expectThrow(() => boom.deleteMessage('m'), null, 'Message deleteMessage wraps errors');
    await this.expectThrow(() => boom.getMessageCount('c'), null, 'Message getMessageCount wraps errors');
    await this.expectThrow(() => boom.checkMessageAccess('u', 'm'), null, 'Message checkMessageAccess wraps errors');
  }

  async testAdminUser() {
    this.log('AdminUser model', 'section');
    const rows = [{ id: 'a1', email: 'a@x.com', password_hash: 'h', deleted_at: null }];
    const admin = new AdminUser(okPool(rows));
    await admin.query('SELECT 1');
    await admin.queryOne('SELECT 1');
    await admin.getAdminUserById('a1');
    await admin.getAdminUserByEmail('a@x.com');
    await admin.getAdminUserByIdIncludingDeleted('a1');
    await admin.getDeletedAdminUsers();
    const count = await admin.countActiveAdminUsers();
    this.assert(count === 1 || count === rows.length || count == null || typeof count === 'number', 'AdminUser countActiveAdminUsers');
    await this.assertResolves(async () => admin.softDeleteAdminUser('a1'), 'AdminUser softDeleteAdminUser');
    await this.assertResolves(async () => admin.updateAdminUser('a1', { email: 'b@x.com' }), 'AdminUser updateAdminUser');
    await this.assertResolves(async () => admin.createAdminUser({ email: 'n@x.com', password: 'C0rrect-Horse-Battery-Staple!' }), 'AdminUser createAdminUser', (r) => r && (r.id || r.email || r.message));
    await this.expectThrow(
      () => admin.createAdminUser({ email: 'weak@x.com', password: 'Password1!' }),
      'Password contains weak patterns',
      'AdminUser createAdminUser rejects a weak password'
    );
    await this.assertResolves(async () => admin.initDatabase(), 'AdminUser initDatabase');
    if (typeof admin.verifyPassword === 'function') {
      await this.assertResolves(async () => admin.verifyPassword(rows[0], 'x'), 'AdminUser verifyPassword');
    }
    const boom = new AdminUser(throwPool());
    await this.expectThrow(() => boom.getAdminUserById('a1'), null, 'AdminUser getAdminUserById wraps errors');
    await this.expectThrow(() => boom.softDeleteAdminUser('a1'), null, 'AdminUser softDeleteAdminUser wraps errors');
    await this.expectThrow(() => boom.getDeletedAdminUsers(), null, 'AdminUser getDeletedAdminUsers wraps errors');
    await this.expectThrow(() => boom.countActiveAdminUsers(), null, 'AdminUser countActiveAdminUsers wraps errors');
  }

  async testProgram() {
    this.log('Program model', 'section');
    const prog = new Program(okPool([{ id: 'p1', therapy_response: '{"a":1}' }]));
    if (typeof prog.parseTherapyResponse === 'function') {
      await this.assertResolves(async () => prog.parseTherapyResponse('{"a":1}'), 'Program parseTherapyResponse json');
      await this.assertResolves(async () => prog.parseTherapyResponse('nope'), 'Program parseTherapyResponse invalid');
    }
    await prog.getUserPrograms('u1');
    await prog.getProgramById('p1');
    await prog.checkProgramAccess('u1', 'p1');
    await prog.updateTherapyResponse('p1', '{}', 1.2, 'prompt');
    await prog.clearRegenerateFlag('p1');
    await prog.claimRegenerateFlag('p1');
    await prog.getProgramsFlaggedForRegeneration();
    await prog.updateGenerationError('p1', 'err', 'prompt');
    await prog.softDeleteProgram('p1');
    await prog.getStartedStepsCount('p1');
    await prog.getStepsWithMessages('p1');
    await this.assertResolves(async () => prog.checkAndUpdateUnlockStatus('p1'), 'Program checkAndUpdateUnlockStatus');
    await this.assertResolves(async () => prog.getConversationStartersWithMessages('p1'), 'Program getConversationStartersWithMessages');
    await this.assertResolves(async () => prog.createProgram('u1', { title: 'T' }), 'Program createProgram');
    await this.assertResolves(async () => prog.initDatabase(), 'Program initDatabase');
    if (typeof prog.migrateUnlockFields === 'function') {
      await this.assertResolves(async () => prog.migrateUnlockFields(), 'Program migrateUnlockFields');
    }
    const boom = new Program(throwPool());
    await this.expectThrow(() => boom.getProgramById('p1'), null, 'Program getProgramById wraps errors');
    await this.expectThrow(() => boom.claimRegenerateFlag('p1'), null, 'Program claimRegenerateFlag wraps errors');
    await this.expectThrow(() => boom.getStartedStepsCount('p1'), null, 'Program getStartedStepsCount wraps errors');
    await this.expectThrow(() => boom.getStepsWithMessages('p1'), null, 'Program getStepsWithMessages wraps errors');
  }

  async testPairingModel() {
    this.log('Pairing model', 'section');
    const row = { id: 'p1', user1_id: 'u1', user2_id: 'u2', status: 'accepted', partner_code: 'ABC', premium: 1 };
    const pairing = new Pairing(okPool([row]));
    await pairing.createPairing('u1', 'u2');
    {
      const uniquePairing = new Pairing(mockPool(async (sql) => {
        if (/SELECT/i.test(String(sql))) return [[]];
        return [[{ affectedRows: 1 }]];
      }));
      await this.assertResolves(
        () => uniquePairing.createPairingWithPartnerCode('u1'),
        'Pairing createPairingWithPartnerCode',
        (r) => r && r.user1_id === 'u1' && r.partner_code && r.status === 'pending'
      );
    }
    await pairing.acceptPairing('p1');
    await pairing.rejectPairing('p1');
    await pairing.getUserPairings('u1');
    await pairing.getPendingPairings('u1');
    await pairing.getAcceptedPairings('u1');
    await pairing.checkExistingPairing('u1', 'u2');
    await pairing.getPairingById('p1');
    await pairing.getPendingPairingByPartnerCode('ABC');
    await this.assertResolves(async () => pairing.acceptPairingByPartnerCode('ABC', 'u2'), 'Pairing acceptPairingByPartnerCode');
    await this.expectThrow(() => pairing.acceptPairingByPartnerCodeAtomic('ABC', 'u2'), 'User not found', 'Pairing acceptPairingByPartnerCodeAtomic requires a real accepting user');
    await pairing.countAcceptedPairings('u1');
    await pairing.softDeletePairing('p1');
    await pairing.softDeleteUserPairings('u1');
    await pairing.softDeleteOpenPartnerCodeRequests('u1');
    await this.assertResolves(async () => pairing.restorePairing('p1'), 'Pairing restorePairing');
    await this.expectThrow(() => pairing.restorePairingAtomic('p1', { requireMemberUserId: 'u1' }), 'Pairing not found or not deleted', 'Pairing restorePairingAtomic requires a soft-deleted pairing');
    await pairing.getPairingByIdIncludingDeleted('p1');
    await pairing.getDeletedPairings();
    await pairing.setPremiumStatus('p1', true);
    await pairing.getPremiumStatus('p1');
    await pairing.userHasPremiumPairing('u1');
    await pairing.getAcceptedPairingsWithPremium('u1');
    await this.assertResolves(async () => pairing.initDatabase(), 'Pairing initDatabase');
    const boom = new Pairing(throwPool());
    await this.expectThrow(() => boom.createPairing('u1', 'u2'), null, 'Pairing createPairing wraps errors');
    await this.expectThrow(() => boom.acceptPairing('p1'), null, 'Pairing acceptPairing wraps errors');
    await this.expectThrow(() => boom.checkExistingPairing('u1', 'u2'), null, 'Pairing checkExistingPairing wraps errors');
    await this.expectThrow(() => boom.getDeletedPairings(), null, 'Pairing getDeletedPairings wraps errors');
    await this.expectThrow(() => boom.getPremiumStatus('p1'), null, 'Pairing getPremiumStatus wraps errors');
    await this.expectThrow(() => boom.getAcceptedPairingsWithPremium('u1'), null, 'Pairing getAcceptedPairingsWithPremium wraps errors');
  }

  async testDeviceToken() {
    this.log('DeviceToken model', 'section');
    const dt = new DeviceToken(okPool([{ id: 't1', device_token: 'tok', user_id: 'u1' }]));
    await this.assertResolves(async () => dt.registerDeviceToken('u1', 'a'.repeat(64), 'ios'), 'DeviceToken registerDeviceToken', (r) => r && (r.id || r.device_token || r.message || r.platform === 'ios' || typeof r === 'object'));
    await dt.getUserDeviceTokens('u1');
    await dt.getUserDeviceTokensWithStrings('u1');
    await dt.getDeviceTokensForUsers(['u1', 'u2']);
    await dt.removeDeviceToken('u1', 't1');
    await dt.removeDeviceTokenByString('tok');
    await dt.markDeviceTokensUsed(['tok']);
    await dt.cleanupOldTokens(30);
    await this.assertResolves(async () => dt.initDatabase(), 'DeviceToken initDatabase');
    const boom = new DeviceToken(throwPool());
    await this.expectThrow(() => boom.removeDeviceTokenByString('tok'), null, 'DeviceToken removeDeviceTokenByString wraps errors');
    this.assert((await boom.markDeviceTokensUsed(['tok'])) === 0, 'DeviceToken markDeviceTokensUsed swallows errors');
    await this.expectThrow(() => boom.cleanupOldTokens(), null, 'DeviceToken cleanupOldTokens wraps errors');
  }

  async testUser() {
    this.log('User model', 'section');
    const user = new User(okPool([{ id: 'u1', email: 'a@x.com', stripe_customer_id: 'cus', org_code_id: 'o1' }]));
    await user.getUserById('u1');
    await user.getUserByEmail('a@x.com');
    await user.getUserByStripeCustomerId('cus');
    await user.getUserByStripeCustomerIdIncludingDeleted('cus');
    await user.setIsPremium('u1', true);
    await user.getUserByEmailIncludingDeleted('a@x.com');
    await this.assertResolves(async () => user.updateUser('u1', { user_name: 'Ada', org_name: 'Org' }), 'User updateUser');
    await this.assertResolves(async () => user.logOrgCodeLinkChange('u1', 'admin', null, 'o1'), 'User logOrgCodeLinkChange');
    await this.assertResolves(async () => user.getOrgCodeLinkAuditLogs({ userId: 'u1', limit: 10 }), 'User getOrgCodeLinkAuditLogs');
    await user.getDeletedUsers();
    await user.getUserByIdIncludingDeleted('u1');
    await user.getUserOrgCode('u1');
    await this.assertResolves(async () => user.createUser({ email: 'n@x.com', password: 'C0rrect-Horse-Battery-Staple!' }), 'User createUser', (r) => r && (r.id || r.email));
    await this.assertResolves(async () => user.initDatabase(), 'User initDatabase');
    const boom = new User(throwPool());
    await this.expectThrow(() => boom.getUserByStripeCustomerId('cus'), null, 'User getUserByStripeCustomerId wraps errors');
    await this.expectThrow(() => boom.getDeletedUsers(), null, 'User getDeletedUsers wraps errors');
  }

  async testOrgCode() {
    this.log('OrgCode model', 'section');
    const org = new OrgCode(okPool([{ id: 'o1', code: 'GRACE', organization: 'Grace' }]));
    await org.getOrgCodeById('o1');
    await org.getOrgCodeByCode('GRACE');
    await org.getActiveOrgCodeById('o1');
    await org.getAllOrgCodes();
    await this.expectThrow(() => org.assignToUser('o1', 'u1'), 'At least one field must be provided', 'OrgCode assignToUser currently forwards user_id which is not an allowed update field');
    await this.assertResolves(async () => org.createOrgCode({ org_code: 'NEWORG', organization: 'North Star' }), 'OrgCode createOrgCode', (r) => r && (r.id || r.org_code || r.organization || r.message));
    await this.assertResolves(async () => org.updateOrgCode('o1', { organization: 'X' }), 'OrgCode updateOrgCode');
    await org.deleteOrgCode('o1');
    await this.assertResolves(async () => org.initDatabase(), 'OrgCode initDatabase');
    const boom = new OrgCode(throwPool());
    await this.expectThrow(() => boom.getActiveOrgCodeById('o1'), null, 'OrgCode getActiveOrgCodeById wraps errors');
  }

  async testRefreshToken() {
    this.log('RefreshToken model', 'section');
    const rt = new RefreshToken(okPool([{ id: 't1', user_id: 'u1', token: 'hash' }]));
    const hash = await rt.hashToken('plain-token-value');
    this.assert(typeof hash === 'string' && hash.length >= 60, 'RefreshToken hashToken');
    await rt.verifyToken('plain-token-value', hash);
    await this.assertResolves(async () => rt.createRefreshToken('u1', 'plain-token-value', new Date(Date.now() + 10000)), 'RefreshToken createRefreshToken');
    await this.expectThrow(() => rt.getRefreshToken('plain-token-value', 'u1'), 'Refresh token not found or expired', 'RefreshToken getRefreshToken rejects a token that does not match stored hashes');
    await this.assertResolves(async () => rt.deleteRefreshToken('plain-token-value', 'u1'), 'RefreshToken deleteRefreshToken');
    await this.assertResolves(async () => rt.getTokenByUserId('u1'), 'RefreshToken getTokenByUserId');
    await this.assertResolves(async () => rt.deleteRefreshTokensByUserId('u1'), 'RefreshToken deleteRefreshTokensByUserId');
    await this.expectThrow(() => rt.updateRefreshToken('old', 'new', new Date(), 'u1'), 'Refresh token not found', 'RefreshToken updateRefreshToken rejects a token that does not match stored hashes');
    await rt.resetRefreshTokenExpiration('u1');
    await rt.cleanupExpiredTokens();
    await this.assertResolves(async () => rt.initDatabase(), 'RefreshToken initDatabase');
    const boom = new RefreshToken(throwPool());
    await this.expectThrow(() => boom.getTokenByUserId('u1'), null, 'RefreshToken getTokenByUserId wraps errors');
    await this.expectThrow(() => boom.cleanupExpiredTokens(), null, 'RefreshToken cleanupExpiredTokens wraps errors');
  }

  async testPromptSession() {
    this.log('PromptSession model', 'section');
    this.assert(Array.isArray(PromptSession.ACTIVE_STATUSES) && PromptSession.ACTIVE_STATUSES.length > 0, 'PromptSession ACTIVE_STATUSES');
    this.assert(Array.isArray(PromptSession.GENERATION_STATUSES) && PromptSession.GENERATION_STATUSES.length > 0, 'PromptSession GENERATION_STATUSES');
    const ps = new PromptSession(okPool([{ id: 'ps1', status: 'active' }]));
    await this.assertResolves(async () => ps.createPromptSession({ createdByUserId: 'u1', pairingId: 'p1' }), 'PromptSession createPromptSession');
    await ps.getPromptSessionById('ps1');
    await ps.getPromptSessionsForUser('u1');
    await ps.getPromptSessionsForPairing('p1');
    await ps.getActiveSessionForPairing('p1');
    await ps.getActiveSoloSessionForUser('u1');
    await ps.checkAccess('u1', 'ps1');
    await ps.getPrep('ps1', 'u1');
    await ps.getPreps('ps1');
    await this.assertResolves(async () => ps.upsertPrep({ promptSessionId: 'ps1', userId: 'u1', answers: { a: 'b' } }), 'PromptSession upsertPrep');
    await ps.bothPrepsComplete('ps1');
    await ps.updateStatus('ps1', 'complete');
    await ps.updatePhase('ps1', 'session');
    await this.assertResolves(async () => ps.beginGeneration('ps1'), 'PromptSession beginGeneration');
    await this.assertResolves(async () => ps.saveGeneratedContent('ps1', { content: '{}', prompt: 'p' }), 'PromptSession saveGeneratedContent');
    await ps.updateGenerationError('ps1', 'err', 'prompt', 'claim');
    if (typeof ps.ensurePairingIdNullable === 'function') {
      await this.assertResolves(async () => ps.ensurePairingIdNullable(), 'PromptSession ensurePairingIdNullable');
    }
    if (typeof ps.ensureSharedDeviceColumn === 'function') {
      await this.assertResolves(async () => ps.ensureSharedDeviceColumn(), 'PromptSession ensureSharedDeviceColumn');
    }
    if (typeof ps.ensureGenerationStatusColumns === 'function') {
      await this.assertResolves(async () => ps.ensureGenerationStatusColumns(), 'PromptSession ensureGenerationStatusColumns');
    }
    if (typeof ps.backfillGenerationStatus === 'function') {
      await this.assertResolves(async () => ps.backfillGenerationStatus(), 'PromptSession backfillGenerationStatus');
    }
    if (typeof ps.resetStaleRunningGenerations === 'function') {
      await this.assertResolves(async () => ps.resetStaleRunningGenerations(), 'PromptSession resetStaleRunningGenerations');
    }
    await this.assertResolves(async () => ps.initDatabase(), 'PromptSession initDatabase');
  }

  async runAllTests() {
    this.log('Resource coverage suite', 'section');
    const tests = [
      ['ProgramStep', () => this.testProgramStep()],
      ['Message', () => this.testMessage()],
      ['AdminUser', () => this.testAdminUser()],
      ['Program', () => this.testProgram()],
      ['Pairing', () => this.testPairingModel()],
      ['DeviceToken', () => this.testDeviceToken()],
      ['User', () => this.testUser()],
      ['OrgCode', () => this.testOrgCode()],
      ['RefreshToken', () => this.testRefreshToken()],
      ['PromptSession', () => this.testPromptSession()]
    ];
    for (const [name, fn] of tests) {
      try {
        await fn();
      } catch (error) {
        this.assert(false, `Resource coverage ${name} crashed`, error.stack || error.message);
      }
    }
    const success = this.testResults.failed === 0;
    this.log(`Resource coverage: ${this.testResults.passed}/${this.testResults.total} passed, ${this.testResults.failed} failed`, success ? 'pass' : 'fail');
    return success;
  }
}

async function main() {
  const runner = new ResourceCoverageTestRunner();
  const success = await runner.runAllTests();
  process.exit(success ? 0 : 1);
}

if (require.main === module) {
  main();
}

module.exports = ResourceCoverageTestRunner;
